/**
 * Regenerates the screenshots in the README, from the same fixture the panel
 * tests render. Not a test — run it with `pnpm screenshot`.
 */
import { mkdir } from "node:fs/promises";
import { launch } from "./e2e/support/browser";
import build from "./e2e/support/build";
import { openPanel } from "./e2e/support/panel";
import { session } from "./support/session";

const OUTPUT = new URL("../docs/", import.meta.url).pathname;

// The panel is served out of `dist/`, so without this the images would show
// whatever was built last rather than what is in the tree.
await build();

const browser = await launch();
await mkdir(OUTPUT, { recursive: true });

for (const colorScheme of ["light", "dark"] as const) {
  const panel = await openPanel(browser, session(), {
    viewport: { width: 1200, height: 560 },
    colorScheme,
  });

  // The listener on `messages`, showing one of the documents it received —
  // the state that says the most about what the panel is for.
  await panel.page.locator("tbody tr").first().click();
  await panel.page.getByRole("button", { name: "Responses" }).click();
  await panel.page.locator("aside ol li button").first().click();
  await panel.page.waitForTimeout(200);

  await panel.page.screenshot({ path: `${OUTPUT}panel-${colorScheme}.png` });
  await panel.close();
  console.log(`wrote docs/panel-${colorScheme}.png`);
}

await browser.close();
