/**
 * Types shared by every context of the extension (MAIN world interceptor,
 * content script bridge, background worker and the DevTools panel).
 *
 * Everything here crosses a `postMessage` / `chrome.runtime` boundary, so it
 * must stay structured-clone friendly: plain objects, arrays and primitives.
 */

/** How the Firestore SDK is talking to the backend. */
export type Transport =
  /** Long-lived WebChannel stream (`Listen` / `Write`). */
  | "webchannel"
  /** One-shot JSON-over-HTTP call (`Commit`, `RunQuery`, ...). */
  | "rest";

/** Which side of the wire a frame came from. */
export type Direction = "outbound" | "inbound";

export type ExchangeState =
  | "pending"
  | "streaming"
  | "complete"
  /** The caller gave up on it — an abort, a navigation. Not a failure. */
  | "canceled"
  | "failed";

/** What we could work out about the RPC behind a request URL. */
export interface RpcInfo {
  /** e.g. `Listen`, `Write`, `Commit`, `RunQuery`. */
  method: string;
  transport: Transport;
  /** e.g. `projects/demo/databases/(default)`, when the URL carries it. */
  database?: string;
  /**
   * For the HTTP RPCs, the resource the URL points at, relative to the
   * database's document root: `""` for `documents:runQuery`, `users/abc` for
   * `documents/users/abc`.
   */
  resource?: string;
}

/**
 * A single message on a stream. Unary calls produce exactly two frames (the
 * request body and the response body); WebChannel streams produce many.
 */
export interface Frame {
  id: string;
  direction: Direction;
  timestamp: number;
  /** Raw text exactly as it appeared on the wire. */
  raw: string;
  /** Parsed payload, when we recognised the framing. */
  decoded?: unknown;
  byteLength: number;
}

/** One HTTP request/response pair carrying Firestore traffic. */
export interface Exchange {
  id: string;
  rpc: RpcInfo;
  state: ExchangeState;
  startedAt: number;
  finishedAt?: number;
  status?: number;
  error?: string;
  frames: Frame[];
}

/** Everything the interceptor knows at the moment a request leaves. */
export type ExchangeStart = Pick<Exchange, "id" | "rpc" | "startedAt">;

/** Fields that are only known once the response settles. */
export type ExchangeEnd = Partial<
  Pick<Exchange, "finishedAt" | "status" | "error">
> & {
  /**
   * The request was cancelled rather than failing. The WebChannel transport
   * cancels as a matter of course — the backchannel is recycled, an
   * unsubscribe drops the request in flight, a navigation takes the lot — and
   * the Network panel does not call any of that an error either.
   */
  canceled?: boolean;
};

export type CaptureEvent =
  | { kind: "start"; exchange: ExchangeStart }
  | { kind: "frame"; exchangeId: string; frame: Frame }
  | { kind: "end"; exchangeId: string; patch: ExchangeEnd };

/** Envelope used for `window.postMessage` between MAIN world and the bridge. */
export const PAGE_MESSAGE_SOURCE = "firestore-devtools/page";

export interface PageMessage {
  source: typeof PAGE_MESSAGE_SOURCE;
  event: CaptureEvent;
}

/** Envelope used for `chrome.runtime.sendMessage` from the bridge. */
export interface CaptureMessage {
  type: "firestore-devtools/capture";
  event: CaptureEvent;
}

/** Name of the long-lived port a DevTools panel opens to the background. */
export const PANEL_PORT_NAME = "firestore-devtools/panel";

/** Panel -> background. */
export type PanelRequest =
  | { type: "subscribe"; tabId: number }
  | { type: "clear"; tabId: number };

/** Background -> panel. */
export type PanelResponse =
  | { type: "snapshot"; exchanges: Exchange[] }
  | { type: "event"; event: CaptureEvent }
  | { type: "cleared" };
