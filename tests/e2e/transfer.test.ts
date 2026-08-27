import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ExportedCapture } from "../../src/shared/export";
import { session } from "../support/session";
import { launch } from "./support/browser";
import { openPanel, type Panel } from "./support/panel";

/**
 * A DevTools panel is an extension page inside an iframe, which is enough of
 * an odd context that "it works on a normal page" says nothing. Both of these
 * are checked against the real panel.
 */
describe("getting the capture out of the panel", () => {
  let browser: Browser;
  let panel: Panel;

  beforeAll(async () => {
    browser = await launch();
    panel = await openPanel(browser, session());
    await panel.page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  afterAll(async () => {
    await panel?.close();
    await browser?.close();
  });

  it("copies the selected action as JSON", async () => {
    await panel.page.locator("tbody tr").first().click();
    await panel.page.getByRole("button", { name: "Copy" }).click();

    // The button says so, and the clipboard agrees.
    await expect
      .poll(() =>
        panel.page.getByRole("button", { name: "Copied" }).isVisible(),
      )
      .toBe(true);

    const copied = JSON.parse(
      await panel.page.evaluate(() => navigator.clipboard.readText()),
    );

    expect(copied).toMatchObject({
      kind: "query",
      target: "messages",
      request: { from: [{ collectionId: "messages" }] },
    });
    expect(copied.responses.map((it: { path: string }) => it.path)).toEqual([
      "messages/m1",
      "messages/m2",
      "messages/m2",
    ]);
  });

  it("saves the whole capture to a file", async () => {
    const [download] = await Promise.all([
      panel.page.waitForEvent("download"),
      panel.page.getByRole("button", { name: "Export" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^firestore-\d{4}-\d{2}-\d{2}T.*\.json$/,
    );

    const path = await download.path();
    const { readFile } = await import("node:fs/promises");
    const capture: ExportedCapture = JSON.parse(await readFile(path, "utf8"));

    expect(capture).toMatchObject({
      extension: "firestore-devtools",
      version: 1,
    });
    expect(capture.actions.map((action) => action.target)).toEqual([
      "messages",
      "users/u1",
      "messages/m3",
      "users",
      "users/u9",
    ]);
  });

  it("offers nothing to export once the capture is cleared", async () => {
    await panel.page.getByRole("button", { name: "Clear" }).click();

    await expect
      .poll(() =>
        panel.page.getByRole("button", { name: "Export" }).isDisabled(),
      )
      .toBe(true);
  });
});
