import type { Browser, Locator, Page } from "playwright";

import type { CaptureEvent, Exchange } from "../../../src/shared/types";
import { type StaticServer, serveDist } from "./browser";

declare global {
  interface Window {
    /** Delivers capture events to the panel as the background worker would. */
    __push: (events: CaptureEvent[]) => void;
    /** Tells the panel the inspected page navigated. */
    __navigate: () => void;
  }
}

export interface PanelOptions {
  viewport?: { width: number; height: number };
  colorScheme?: "light" | "dark";
}

export interface Panel {
  page: Page;
  /** The action list, which is the element that scrolls. */
  list: Locator;
  rows: () => Promise<string[][]>;
  push: (events: CaptureEvent[]) => Promise<void>;
  navigate: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Opens the built panel with `chrome.devtools` and the port to the background
 * worker stubbed out, so the React app can be driven from a fixture.
 */
export async function openPanel(
  browser: Browser,
  exchanges: Exchange[],
  { viewport = { width: 1200, height: 640 }, colorScheme }: PanelOptions = {},
): Promise<Panel> {
  const server: StaticServer = await serveDist();
  const page = await browser.newPage({ viewport, colorScheme });

  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));

  await page.addInitScript((backlog: Exchange[]) => {
    const listeners: Array<(message: unknown) => void> = [];
    const navigated: Array<() => void> = [];

    window.__navigate = () => {
      for (const listener of navigated) listener();
    };

    window.__push = (events) => {
      for (const event of events) {
        for (const listener of listeners) listener({ type: "event", event });
      }
    };

    // Only the two APIs the panel actually reaches for.
    (window as unknown as { chrome: unknown }).chrome = {
      devtools: {
        inspectedWindow: { tabId: 7 },
        network: {
          onNavigated: {
            addListener: (fn: () => void) => navigated.push(fn),
            removeListener: (fn: () => void) => {
              const at = navigated.indexOf(fn);
              if (at !== -1) navigated.splice(at, 1);
            },
          },
        },
      },
      runtime: {
        connect: () => ({
          name: "firestore-devtools/panel",
          onMessage: {
            addListener: (fn: (m: unknown) => void) => listeners.push(fn),
          },
          onDisconnect: { addListener: () => {} },
          postMessage: (request: { type: string }) => {
            if (request.type !== "subscribe") return;
            setTimeout(() => {
              for (const listener of listeners) {
                listener({ type: "snapshot", exchanges: backlog });
              }
            }, 0);
          },
          disconnect: () => {},
        }),
      },
    };
  }, exchanges);

  await page.goto(`${server.origin}/panel/index.html`);
  await page.waitForSelector("table, p");

  return {
    page,
    list: page.locator("table").locator("xpath=.."),
    rows: () =>
      page
        .locator("tbody tr")
        .evaluateAll((rows) =>
          rows.map((row) =>
            Array.from(row.children, (cell) => cell.textContent?.trim() ?? ""),
          ),
        ),
    push: async (events) => {
      await page.evaluate((batch) => window.__push(batch), events);
      // The panel coalesces updates to one per animation frame.
      await page.waitForTimeout(120);
    },
    navigate: async () => {
      await page.evaluate(() => window.__navigate());
      await page.waitForTimeout(120);
    },
    close: async () => {
      await page.close();
      await server.close();
      if (failures.length > 0) {
        throw new Error(`the panel threw: ${failures.join("; ")}`);
      }
    },
  };
}
