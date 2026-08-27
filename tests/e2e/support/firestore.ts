import { createServer } from "node:http";

import { close, listen } from "./browser";

const DATABASE = "projects/demo/databases/(default)";
const DOCUMENTS = `${DATABASE}/documents`;

/** The page under test: it records what the interceptor posts to the bridge. */
const PAGE = `<!doctype html>
<meta charset="utf-8" />
<title>a page that uses Firestore</title>
<script>
  window.__captured = [];
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "firestore-devtools/page") return;
    window.__captured.push(event.data.event);
  });
</script>
<body>fake app</body>`;

/** One length-prefixed WebChannel chunk. */
function chunk(payload: unknown): string {
  const json = JSON.stringify(payload);
  return `${json.length}\n${json}`;
}

export interface FirestoreServer {
  origin: string;
  close: () => Promise<void>;
}

/**
 * Stands in for `firestore.googleapis.com`, on the paths the SDK really uses:
 * a `Listen` channel that dribbles chunks out over time, and a unary `Commit`.
 */
export async function serveFirestore(): Promise<FirestoreServer> {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");

    if (pathname === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(PAGE);
      return;
    }

    if (pathname === "/google.firestore.v1.Firestore/Listen/channel") {
      drain(request, () => {
        response.writeHead(200, {
          "content-type": "application/json+protobuf",
          "x-test": "listen",
        });
        response.write(chunk([[1, ["c", "SID-abc", "", 8]]]));

        setTimeout(() => {
          response.write(
            chunk([
              [
                2,
                [{ targetChange: { targetChangeType: "ADD", targetIds: [2] } }],
              ],
            ]),
          );
        }, 60);

        setTimeout(() => {
          response.write(
            chunk([
              [
                3,
                [
                  {
                    documentChange: {
                      document: { name: `${DOCUMENTS}/messages/m1` },
                      targetIds: [2],
                    },
                  },
                ],
              ],
            ]),
          );
          response.end();
        }, 120);
      });
      return;
    }

    if (pathname === `/v1/${DOCUMENTS}:commit`) {
      drain(request, () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            writeResults: [{ updateTime: "2026-08-27T00:00:00Z" }],
            commitTime: "2026-08-27T00:00:00Z",
          }),
        );
      });
      return;
    }

    response.writeHead(404).end();
  });

  return { origin: await listen(server), close: () => close(server) };
}

function drain(request: NodeJS.ReadableStream, then: () => void): void {
  request.resume();
  request.on("end", then);
}

export { DATABASE, DOCUMENTS };
