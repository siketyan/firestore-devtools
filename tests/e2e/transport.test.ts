import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { session } from "../support/session";
import { launch } from "./support/browser";
import { openPanel, type Panel } from "./support/panel";

/**
 * The action view drops the channel's own bookkeeping, which is exactly what
 * you want to see when the channel itself is the thing misbehaving. The
 * Transport view is where it went.
 */
describe("the transport view", () => {
  let browser: Browser;
  let panel: Panel;

  beforeAll(async () => {
    browser = await launch();
    panel = await openPanel(browser, session());
    await panel.page.getByRole("button", { name: "Transport" }).click();
  });

  afterAll(async () => {
    await panel?.close();
    await browser?.close();
  });

  it("lists the HTTP exchanges rather than the actions", async () => {
    // Six exchanges carried the five actions, which is the whole point.
    const rows = await panel.rows();

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row[0])).toEqual([
      "Listen",
      "Listen",
      "Listen",
      "Write",
      "RunQuery",
      "GetDocument",
    ]);
  });

  it("counts exchanges, not actions", async () => {
    await expect
      .poll(() => panel.page.locator("header, div").first().innerText())
      .toContain("6 exchanges");
  });

  it("shows the handshakes the action view drops", async () => {
    // The shared backchannel: a control frame, then the target's traffic.
    await panel.page.locator("tbody tr").first().click();
    const frames = await panel.page
      .locator("aside ol li button")
      .allInnerTexts();

    expect(frames[0]).toContain("c, SID-abc");
    expect(frames.some((frame) => frame.includes("targetChange"))).toBe(true);
  });

  it("shows a frame exactly as it arrived", async () => {
    await panel.page.locator("aside ol li button").first().click();
    const payload = await panel.page.locator("aside").innerText();

    expect(payload).toContain("SID-abc");
  });

  it("searches the wire", async () => {
    await panel.page.fill("input[type=search]", "streamToken");
    await expect.poll(async () => (await panel.rows()).length).toBe(1);
    expect((await panel.rows())[0]?.[0]).toBe("Write");

    await panel.page.fill("input[type=search]", "");
  });

  it("goes back to the actions", async () => {
    await panel.page.getByRole("button", { name: "Actions" }).click();

    await expect.poll(async () => (await panel.rows()).length).toBe(5);
  });
});
