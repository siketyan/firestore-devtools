/**
 * Rasterises `src/images/icon.svg` into the sizes the manifest declares. Not a
 * test — run it with `pnpm icons`.
 *
 * Each size is rendered from the source rather than resampled from one large
 * image: the icon is mostly 1px features at 16, and downscaling a 128 loses
 * them. Chromium does the rendering, so this needs the same browser the e2e
 * tests do.
 */
import { readFile, writeFile } from "node:fs/promises";
import { launch } from "./e2e/support/browser";

const IMAGES = new URL("../src/images/", import.meta.url).pathname;

/** What `src/manifest.json` asks for: 48 is the extensions page, 96 the
 * add-on detail view Firefox shows. */
const SIZES = [16, 32, 48, 96, 128];

const svg = await readFile(`${IMAGES}icon.svg`, "utf8");
const browser = await launch();
const page = await browser.newPage();

for (const size of SIZES) {
  await page.setContent(
    `<style>html,body{margin:0}#icon{width:${size}px;height:${size}px}</style>` +
      `<div id="icon">${svg}</div>`,
  );

  const png = await page
    .locator("#icon")
    .screenshot({ omitBackground: true, scale: "css" });

  await writeFile(`${IMAGES}icon-${size}.png`, png);
  console.log(`wrote src/images/icon-${size}.png`);
}

await browser.close();
