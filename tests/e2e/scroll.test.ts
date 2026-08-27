import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CaptureEvent, Exchange } from "../../src/shared/types";
import { DOCUMENTS, exchange, frame, restRpc } from "../support/session";
import { launch } from "./support/browser";
import { openPanel, type Panel } from "./support/panel";

const ORIGIN = "https://firestore.googleapis.com";

/** A completed document read, which is the smallest thing that makes a row. */
function read(index: number): Exchange {
  const path = `users/u${index}`;

  return exchange(
    `read-${index}`,
    restRpc("GetDocument", path),
    `${ORIGIN}/v1/${DOCUMENTS}/${path}`,
    index * 10,
    [
      frame("inbound", index * 10 + 4, {
        name: `${DOCUMENTS}/${path}`,
        fields: {},
      }),
    ],
    { method: "GET", state: "complete", status: 200, finishedAt: 0 },
  );
}

/** The same read, as the events the background worker would relay. */
function readEvents(index: number): CaptureEvent[] {
  const { frames, ...rest } = read(index);
  const first = frames[0];
  if (!first) throw new Error("a read has one frame");

  return [
    {
      kind: "start",
      exchange: {
        id: rest.id,
        pageUrl: rest.pageUrl,
        url: rest.url,
        method: rest.method,
        rpc: rest.rpc,
        startedAt: rest.startedAt,
        requestHeaders: rest.requestHeaders,
        bytesSent: rest.bytesSent,
      },
    },
    { kind: "frame", exchangeId: rest.id, frame: first },
    { kind: "end", exchangeId: rest.id, patch: { status: 200 } },
  ];
}

describe("following new actions", () => {
  let browser: Browser;
  let panel: Panel;
  let next = 40;

  const metrics = () =>
    panel.list.evaluate((element) => ({
      top: Math.round(element.scrollTop),
      bottom: Math.round(element.scrollHeight - element.clientHeight),
      rows: element.querySelectorAll("tbody tr").length,
    }));

  const arrive = async (count: number) => {
    const events: CaptureEvent[] = [];
    for (let n = 0; n < count; n += 1) events.push(...readEvents(next++));
    await panel.push(events);
  };

  beforeAll(async () => {
    browser = await launch();
    panel = await openPanel(
      browser,
      Array.from({ length: 40 }, (_, index) => read(index)),
      // Short enough that forty rows do not fit.
      { width: 1000, height: 500 },
    );
  });

  afterAll(async () => {
    await panel?.close();
    await browser?.close();
  });

  it("opens at the newest row", async () => {
    const list = await metrics();

    expect(list.rows).toBe(40);
    expect(list.bottom).toBeGreaterThan(0);
    expect(list.top).toBe(list.bottom);
  });

  it("stays at the bottom as more arrive", async () => {
    const before = await metrics();
    await arrive(5);
    const after = await metrics();

    expect(after.rows).toBe(45);
    expect(after.bottom).toBeGreaterThan(before.bottom);
    expect(after.top).toBe(after.bottom);
  });

  it("leaves a reader who scrolled up where they were", async () => {
    await panel.list.evaluate((element) => {
      element.scrollTop = 0;
    });
    await arrive(5);

    expect(await metrics()).toMatchObject({ top: 0, rows: 50 });
  });

  it("follows again once they scroll back down", async () => {
    await panel.list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await arrive(3);
    const list = await metrics();

    expect(list.rows).toBe(53);
    expect(list.top).toBe(list.bottom);
  });
});
