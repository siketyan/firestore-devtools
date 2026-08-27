import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { session } from "../support/session";
import { launch } from "./support/browser";
import { openPanel, type Panel } from "./support/panel";

/**
 * DevTools clears its lists when the page navigates unless you ask it not to,
 * and this panel follows that: the capture describes the page in front of
 * you, not the one before it.
 */
describe("navigating the inspected page", () => {
  let browser: Browser;
  let panel: Panel;

  beforeAll(async () => {
    browser = await launch();
    panel = await openPanel(browser, session());
  });

  afterAll(async () => {
    await panel?.close();
    await browser?.close();
  });

  it("clears the capture", async () => {
    expect(await panel.rows()).toHaveLength(5);

    await panel.navigate();

    expect(await panel.rows()).toHaveLength(0);
  });

  it("keeps recording the page it landed on", async () => {
    await panel.push(
      // The first two exchanges of the fixture are enough to make one action.
      (await import("../support/session")).events(session().slice(0, 2)),
    );

    expect((await panel.rows()).length).toBeGreaterThan(0);
  });

  it("keeps the capture when Preserve log is ticked", async () => {
    await panel.page.getByLabel("Preserve log").check();
    const before = (await panel.rows()).length;

    await panel.navigate();

    expect(await panel.rows()).toHaveLength(before);
  });

  it("remembers the toggle across a reload of the panel", async () => {
    await panel.page.reload();
    await panel.page.waitForSelector("table, p");

    await expect
      .poll(() => panel.page.getByLabel("Preserve log").isChecked())
      .toBe(true);
  });
});
