import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { session } from "../support/session";
import { launch } from "./support/browser";
import { openPanel, type Panel } from "./support/panel";

/**
 * Drives the built panel over the session fixture. What is being checked is
 * what a developer reads: the rows, and the two views behind them.
 */
describe("the panel", () => {
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

  it("lists one row per action, verb first", async () => {
    expect((await panel.rows()).map((row) => row.slice(0, 4))).toEqual([
      ["QUERY", "messages", "active", "3"],
      ["GET", "users/u1", "active", "1"],
      ["WRITE", "messages/m3", "complete", "1"],
      ["QUERY", "users", "200", "2"],
      ["GET", "users/u9", "403", "—"],
    ]);
  });

  it("filters on what the rows say", async () => {
    await panel.page.fill("input[type=search]", "users");
    await expect.poll(async () => (await panel.rows()).length).toBe(3);

    await panel.page.getByRole("button", { name: "Write" }).click();
    await expect.poll(async () => (await panel.rows()).length).toBe(0);

    await panel.page.getByRole("button", { name: "All" }).click();
    await panel.page.fill("input[type=search]", "");
    await expect.poll(async () => (await panel.rows()).length).toBe(5);
  });

  describe("a listener on a query", () => {
    beforeAll(async () => {
      await panel.page.locator("tbody tr").first().click();
      await panel.page.waitForSelector("aside");
    });

    it("names the collection it is watching", async () => {
      await expect
        .poll(() => panel.page.locator("aside header").innerText())
        .toContain("messages");
    });

    it("lists documents rather than the events that carried them", async () => {
      await panel.page.getByRole("button", { name: "Responses" }).click();

      expect(
        await panel.page.locator("aside ol li button").allInnerTexts(),
      ).toEqual([
        expect.stringContaining("m1"),
        expect.stringContaining("m2"),
        expect.stringContaining("removed"),
      ]);
    });

    it("shows a document without its event wrapper", async () => {
      await panel.page.locator("aside ol li button").first().click();
      const payload = await panel.page.locator("aside").innerText();

      expect(payload).toContain("fields");
      expect(payload).toContain("createTime");
      expect(payload).not.toContain("documentChange");
      expect(payload).not.toContain("targetIds");
    });

    it("shows the structured query without the plumbing around it", async () => {
      await panel.page.getByRole("button", { name: "Request" }).click();
      const request = await panel.page.locator("aside").innerText();

      expect(request).toContain("from");
      expect(request).toContain("orderBy");
      expect(request).toContain("limit");
      expect(request).not.toContain("addTarget");
      expect(request).not.toContain("structuredQuery");
    });
  });

  it("shows an error body whole, since that is when you look", async () => {
    await panel.page.locator("tbody tr").last().click();
    await panel.page.getByRole("button", { name: "Responses" }).click();

    await expect
      .poll(() => panel.page.locator("aside").innerText())
      .toContain("Missing or insufficient permissions.");
  });
});
