import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { type Browser, type BrowserContext, chromium } from "playwright";

import { DIST } from "./build";

/**
 * Where to find Chromium. Playwright's own download is the default; set
 * `CHROMIUM_PATH` when the box already has a browser Playwright did not put
 * there, as CI images often do.
 */
const executablePath = process.env.CHROMIUM_PATH || undefined;

/** Sandboxing has to go in a container, and only there. */
const args = process.env.CI ? ["--no-sandbox", "--disable-gpu"] : [];

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath, args });
}

/** A browser with the built extension loaded, which needs a real profile. */
export async function launchWithExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), "fsdt-")),
    {
      executablePath,
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        ...args,
      ],
    },
  );
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".png": "image/png",
};

export interface StaticServer {
  origin: string;
  close: () => Promise<void>;
}

/**
 * Serves the built extension over HTTP. The panel is a normal page, so it can
 * be opened directly — but only over a real origin, because it loads its
 * bundle from an absolute path.
 */
export async function serveDist(): Promise<StaticServer> {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const file = join(DIST, decodeURIComponent(pathname));

    if (!existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  });

  return { origin: await listen(server), close: () => close(server) };
}

export function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        throw new Error("the server did not bind to a port");
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

export function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
