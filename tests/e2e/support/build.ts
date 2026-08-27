import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

export const DIST = new URL("../../../dist/chromium/", import.meta.url)
  .pathname;

/**
 * Builds the extension once for the whole e2e run. These tests drive the real
 * bundle in a real browser; testing the sources instead would not tell us
 * whether the manifest, the content scripts and the panel fit together.
 */
export default async function build(): Promise<void> {
  // `--no-install` so a missing dependency fails loudly instead of being
  // fetched from the registry mid-test.
  await run(
    "npx",
    ["--no-install", "extension", "build", "--browser", "chromium"],
    {
      cwd: new URL("../../../", import.meta.url).pathname,
      env: { ...process.env, EXTENSION_TELEMETRY: "0" },
    },
  );

  if (!existsSync(`${DIST}manifest.json`)) {
    throw new Error(`the build produced nothing in ${DIST}`);
  }
}
