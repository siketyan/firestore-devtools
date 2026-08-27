/**
 * A scripted Firestore session, shared by the correlator tests and the panel
 * tests so both are talking about the same traffic.
 *
 * It is deliberately awkward in the way the real thing is: two listeners share
 * one backchannel, their requests go out on separate exchanges, and the write
 * stream answers out of band.
 */
import type {
  CaptureEvent,
  Exchange,
  Frame,
  RpcInfo,
} from "../../src/shared/types";

export const DATABASE = "projects/demo/databases/(default)";
export const DOCUMENTS = `${DATABASE}/documents`;

const ORIGIN = "https://firestore.googleapis.com";
const CHANNEL = `${ORIGIN}/google.firestore.v1.Firestore`;
const START = 1_756_300_000_000;

export const LISTEN_RPC: RpcInfo = {
  service: "google.firestore.v1.Firestore",
  method: "Listen",
  transport: "webchannel",
  database: DATABASE,
};

export const WRITE_RPC: RpcInfo = { ...LISTEN_RPC, method: "Write" };

export function restRpc(method: string, resource = ""): RpcInfo {
  return {
    service: "google.firestore.v1.Firestore",
    method,
    transport: "rest",
    database: DATABASE,
    resource,
  };
}

let sequence = 0;

/** A decoded frame at `offset` milliseconds into the session. */
export function frame(
  direction: Frame["direction"],
  offset: number,
  decoded: unknown,
  label?: string,
): Frame {
  sequence += 1;
  const raw = JSON.stringify(decoded);
  return {
    id: `frame-${sequence}`,
    direction,
    timestamp: START + offset,
    raw,
    decoded,
    label,
    byteLength: raw.length,
  };
}

export function exchange(
  id: string,
  rpc: RpcInfo,
  url: string,
  offset: number,
  frames: Frame[],
  over: Partial<Exchange> = {},
): Exchange {
  return {
    id,
    pageUrl: "https://app.example.com/",
    url,
    method: "POST",
    rpc,
    state: "streaming",
    startedAt: START + offset,
    requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
    responseHeaders: { "content-type": "application/json+protobuf" },
    bytesSent: 0,
    bytesReceived: 0,
    frames,
    ...over,
  };
}

/**
 * The session as a list of exchanges: one shared Listen backchannel, two
 * listeners that requested on their own POSTs, a write stream, a one-shot
 * query and a document read that was refused.
 */
export function session(): Exchange[] {
  sequence = 0;

  return [
    exchange(
      "backchannel",
      LISTEN_RPC,
      `${CHANNEL}/Listen/channel?VER=8&RID=rpc&TYPE=xmlhttp`,
      0,
      [
        frame("inbound", 10, ["c", "SID-abc", "", 8], "c, SID-abc"),
        frame(
          "inbound",
          300,
          [{ targetChange: { targetChangeType: "ADD", targetIds: [2] } }],
          "targetChange",
        ),
        frame(
          "inbound",
          340,
          [
            {
              documentChange: {
                document: {
                  name: `${DOCUMENTS}/messages/m1`,
                  fields: {
                    body: { stringValue: "hello" },
                    createdAt: { timestampValue: "2026-08-27T12:59:00Z" },
                  },
                  createTime: "2026-08-27T12:59:00Z",
                },
                targetIds: [2],
              },
            },
          ],
          "documentChange",
        ),
        frame(
          "inbound",
          360,
          [
            {
              documentChange: {
                document: {
                  name: `${DOCUMENTS}/messages/m2`,
                  fields: { body: { stringValue: "hi" } },
                },
                targetIds: [2],
              },
            },
          ],
          "documentChange",
        ),
        frame(
          "inbound",
          380,
          [
            {
              targetChange: {
                targetChangeType: "CURRENT",
                targetIds: [2],
                readTime: "2026-08-27T13:00:00Z",
              },
            },
          ],
          "targetChange",
        ),
        frame(
          "inbound",
          900,
          [
            {
              documentChange: {
                document: {
                  name: `${DOCUMENTS}/users/u1`,
                  fields: { name: { stringValue: "Ada" } },
                },
                targetIds: [4],
              },
            },
          ],
          "documentChange",
        ),
        frame(
          "inbound",
          950,
          [
            {
              documentDelete: {
                document: `${DOCUMENTS}/messages/m2`,
                removedTargetIds: [2],
              },
            },
          ],
          "documentDelete",
        ),
      ],
    ),

    exchange(
      "listen-query",
      LISTEN_RPC,
      `${CHANNEL}/Listen/channel?VER=8&RID=1`,
      100,
      [
        frame(
          "outbound",
          110,
          {
            database: DATABASE,
            addTarget: {
              targetId: 2,
              query: {
                parent: DOCUMENTS,
                structuredQuery: {
                  from: [{ collectionId: "messages" }],
                  where: {
                    fieldFilter: {
                      field: { fieldPath: "read" },
                      op: "EQUAL",
                      value: { booleanValue: false },
                    },
                  },
                  orderBy: [
                    {
                      field: { fieldPath: "createdAt" },
                      direction: "DESCENDING",
                    },
                  ],
                  limit: 25,
                },
              },
            },
          },
          "database, addTarget",
        ),
      ],
      { state: "complete", status: 200, finishedAt: START + 130 },
    ),

    exchange(
      "listen-document",
      LISTEN_RPC,
      `${CHANNEL}/Listen/channel?VER=8&RID=2`,
      200,
      [
        frame(
          "outbound",
          210,
          {
            database: DATABASE,
            addTarget: {
              targetId: 4,
              documents: { documents: [`${DOCUMENTS}/users/u1`] },
            },
          },
          "database, addTarget",
        ),
      ],
      { state: "complete", status: 200, finishedAt: START + 230 },
    ),

    exchange("write", WRITE_RPC, `${CHANNEL}/Write/channel?VER=8`, 1000, [
      frame("outbound", 1010, { database: DATABASE }, "database"),
      frame(
        "inbound",
        1020,
        [{ streamId: "S1", streamToken: "tok0" }],
        "streamId, streamToken",
      ),
      frame(
        "outbound",
        1200,
        {
          streamToken: "tok0",
          writes: [
            {
              update: {
                name: `${DOCUMENTS}/messages/m3`,
                fields: { body: { stringValue: "sent" } },
              },
            },
          ],
        },
        "streamToken, writes",
      ),
      frame(
        "inbound",
        1260,
        [
          {
            streamToken: "tok1",
            writeResults: [{ updateTime: "2026-08-27T13:00:02Z" }],
            commitTime: "2026-08-27T13:00:02Z",
          },
        ],
        "writeResults",
      ),
    ]),

    exchange(
      "run-query",
      restRpc("RunQuery"),
      `${ORIGIN}/v1/${DOCUMENTS}:runQuery`,
      1500,
      [
        frame(
          "outbound",
          1500,
          {
            structuredQuery: {
              from: [{ collectionId: "users" }],
              where: {
                fieldFilter: {
                  field: { fieldPath: "age" },
                  op: "GREATER_THAN_OR_EQUAL",
                  value: { integerValue: "18" },
                },
              },
              limit: 10,
            },
          },
          "structuredQuery",
        ),
        frame(
          "inbound",
          1580,
          [
            { document: { name: `${DOCUMENTS}/users/u1` } },
            { document: { name: `${DOCUMENTS}/users/u2` } },
          ],
          "document",
        ),
      ],
      { state: "complete", status: 200, finishedAt: START + 1590 },
    ),

    exchange(
      "get-document",
      restRpc("GetDocument", "users/u9"),
      `${ORIGIN}/v1/${DOCUMENTS}/users/u9`,
      1700,
      [
        frame(
          "inbound",
          1740,
          {
            error: {
              code: 403,
              message: "Missing or insufficient permissions.",
            },
          },
          "error",
        ),
      ],
      {
        method: "GET",
        state: "failed",
        status: 403,
        statusText: "Forbidden",
        finishedAt: START + 1745,
      },
    ),
  ];
}

/**
 * The same session as the event stream the capture pipeline produces, with the
 * frames interleaved by arrival time the way they really are.
 */
export function events(exchanges = session()): CaptureEvent[] {
  const starts = exchanges.map((it) => ({
    kind: "start" as const,
    exchange: {
      id: it.id,
      pageUrl: it.pageUrl,
      url: it.url,
      method: it.method,
      rpc: it.rpc,
      startedAt: it.startedAt,
      requestHeaders: it.requestHeaders,
      bytesSent: it.bytesSent,
    },
  }));

  const frames = exchanges
    .flatMap((it) =>
      it.frames.map((each) => ({
        kind: "frame" as const,
        exchangeId: it.id,
        frame: each,
      })),
    )
    .sort((a, b) => a.frame.timestamp - b.frame.timestamp);

  const ends = exchanges
    .filter((it) => it.state === "complete" || it.state === "failed")
    .map((it) => ({
      kind: "end" as const,
      exchangeId: it.id,
      patch: {
        status: it.status,
        statusText: it.statusText,
        finishedAt: it.finishedAt,
        responseHeaders: it.responseHeaders,
        bytesReceived: it.bytesReceived,
      },
    }));

  return [...starts, ...frames, ...ends];
}
