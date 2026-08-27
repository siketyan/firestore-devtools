import type { BrowserContext, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CaptureEvent,
  ExchangeStart,
  Frame,
} from "../../src/shared/types";
import { launchWithExtension } from "./support/browser";
import {
  DOCUMENTS,
  type FirestoreServer,
  serveFirestore,
} from "./support/firestore";

declare global {
  interface Window {
    __captured: CaptureEvent[];
  }
}

/**
 * Drives the built extension in a real browser against a stand-in for
 * Firestore, and reads what the MAIN world interceptor posted to the bridge.
 * This is the only place the wrapping of `fetch` and `XMLHttpRequest` is
 * exercised as it actually runs.
 */
describe("capturing a page's Firestore traffic", () => {
  let context: BrowserContext;
  let firestore: FirestoreServer;
  let page: Page;
  let captured: CaptureEvent[];

  beforeAll(async () => {
    firestore = await serveFirestore();
    context = await launchWithExtension();
    page = await context.newPage();
    await page.goto(`${firestore.origin}/`);

    // A streaming Listen over XHR, which is what the WebChannel is built on.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open(
            "POST",
            "/google.firestore.v1.Firestore/Listen/channel?database=projects%2Fdemo%2Fdatabases%2F(default)&VER=8&RID=1&SID=abc&TYPE=xmlhttp",
          );
          xhr.setRequestHeader(
            "Content-Type",
            "application/x-www-form-urlencoded",
          );
          xhr.addEventListener("loadend", () => resolve());
          xhr.send(
            `count=1&ofs=0&req0___data__=${encodeURIComponent(
              JSON.stringify({
                database: "projects/demo/databases/(default)",
                addTarget: { query: { parent: "x" }, targetId: 2 },
              }),
            )}`,
          );
        }),
    );

    // A unary Commit over fetch.
    await page.evaluate(
      (documents) =>
        fetch(`/v1/${documents}:commit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            writes: [{ update: { name: `${documents}/messages/m1` } }],
          }),
        }).then((response) => response.json()),
      DOCUMENTS,
    );

    // And something that is not Firestore at all.
    await page.evaluate(() => fetch("/nope").catch(() => undefined));

    await page.waitForFunction(
      () => window.__captured.filter((it) => it.kind === "end").length === 2,
    );
    captured = await page.evaluate(() => window.__captured);
  });

  afterAll(async () => {
    await context?.close();
    await firestore?.close();
  });

  const starts = () =>
    captured
      .filter((event) => event.kind === "start")
      .map((event) => event.exchange);

  const framesOf = (exchange: ExchangeStart): Frame[] =>
    captured
      .filter(
        (event) => event.kind === "frame" && event.exchangeId === exchange.id,
      )
      .map(
        (event) => (event as Extract<CaptureEvent, { kind: "frame" }>).frame,
      );

  const exchangeFor = (method: string): ExchangeStart => {
    const found = starts().find((it) => it.rpc.method === method);
    if (!found) throw new Error(`nothing captured for ${method}`);
    return found;
  };

  it("captures the Firestore requests and nothing else", () => {
    expect(
      starts()
        .map((it) => it.rpc.method)
        .sort(),
    ).toEqual(["Commit", "Listen"]);
  });

  it("reads the database off the channel URL", () => {
    expect(exchangeFor("Listen").rpc).toMatchObject({
      transport: "webchannel",
      database: "projects/demo/databases/(default)",
    });
  });

  it("decodes the outbound WebChannel message", () => {
    const outbound = framesOf(exchangeFor("Listen")).filter(
      (frame) => frame.direction === "outbound",
    );

    expect(outbound.map((frame) => frame.label)).toEqual([
      "database, addTarget",
    ]);
  });

  it("decodes the stream as it arrives, not when it closes", () => {
    const inbound = framesOf(exchangeFor("Listen")).filter(
      (frame) => frame.direction === "inbound",
    );

    expect(inbound.map((frame) => frame.label)).toEqual([
      "c, SID-abc",
      "targetChange",
      "documentChange",
    ]);
    // Each chunk was written 60ms apart, so they cannot share a timestamp.
    expect(new Set(inbound.map((frame) => frame.timestamp)).size).toBe(3);
  });

  it("decodes a unary response", () => {
    const [request, response] = framesOf(exchangeFor("Commit"));

    expect(request?.direction).toBe("outbound");
    expect(response?.decoded).toMatchObject({
      commitTime: "2026-08-27T00:00:00Z",
    });
  });

  it("reports the outcome of each exchange", () => {
    const ends = captured.filter((event) => event.kind === "end");

    expect(ends.map((event) => event.patch.status)).toEqual([200, 200]);
    expect(
      ends.find((event) => event.exchangeId === exchangeFor("Listen").id)?.patch
        .responseHeaders,
    ).toMatchObject({ "x-test": "listen" });
  });

  it("registers the background worker", async () => {
    await expect
      .poll(() => context.serviceWorkers().length, { timeout: 10_000 })
      .toBeGreaterThan(0);
  });
});
