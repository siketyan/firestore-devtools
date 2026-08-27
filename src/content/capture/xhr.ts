/**
 * Wraps `XMLHttpRequest`, which is what the Closure WebChannel used by the
 * `Listen` and `Write` streams is built on.
 */
import { identifyRpc } from "../../shared/firestore";
import type { RpcInfo } from "../../shared/types";
import { emitEnd, emitStart, nextId } from "./channel";
import {
  bodyToText,
  createResponseSink,
  emitRequestFrames,
  type ResponseSink,
} from "./payload";

interface XhrState {
  rpc: RpcInfo;
  exchangeId: string;
  sink: ResponseSink;
  finished: boolean;
}

const xhrStates = new WeakMap<XMLHttpRequest, XhrState>();

export function patchXhr(): void {
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  proto.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const rpc = identifyRpc(String(url), method);

    if (rpc) {
      const exchangeId = nextId("xhr");
      xhrStates.set(this, {
        rpc,
        exchangeId,
        sink: createResponseSink(exchangeId, rpc),
        finished: false,
      });
    } else {
      xhrStates.delete(this);
    }

    return (originalOpen as (...args: unknown[]) => void).call(
      this,
      method,
      url,
      ...rest,
    );
  } as typeof proto.open;

  proto.send = function patchedSend(this: XMLHttpRequest, body?: unknown) {
    const state = xhrStates.get(this);
    if (!state) return originalSend.call(this, body as XMLHttpRequestBodyInit);

    emitStart({
      id: state.exchangeId,
      rpc: state.rpc,
      startedAt: Date.now(),
    });
    emitRequestFrames(state.exchangeId, state.rpc, bodyToText(body));

    // `readystatechange` fires on every flushed chunk while the WebChannel
    // stream is open, which is what makes incremental decoding possible.
    this.addEventListener("readystatechange", () => pump(this));
    this.addEventListener("progress", () => pump(this));
    this.addEventListener("loadend", () => finish(this));
    this.addEventListener("error", () =>
      finish(this, "Network request failed"),
    );
    this.addEventListener("timeout", () => finish(this, "Request timed out"));
    this.addEventListener("abort", () => finish(this, "Request aborted"));

    return originalSend.call(this, body as XMLHttpRequestBodyInit);
  };
}

function readText(xhr: XMLHttpRequest): string | undefined {
  // `responseText` throws when the caller asked for a binary responseType.
  try {
    return xhr.responseType === "" || xhr.responseType === "text"
      ? xhr.responseText
      : undefined;
  } catch {
    return undefined;
  }
}

function pump(xhr: XMLHttpRequest): void {
  const state = xhrStates.get(xhr);
  if (!state || state.finished) return;
  if (xhr.readyState < XMLHttpRequest.LOADING) return;

  const text = readText(xhr);
  if (text != null) state.sink.replace(text);
}

function finish(xhr: XMLHttpRequest, error?: string): void {
  const state = xhrStates.get(xhr);
  if (!state || state.finished) return;

  pump(xhr);
  state.finished = true;
  state.sink.finish();

  emitEnd(state.exchangeId, {
    finishedAt: Date.now(),
    status: xhr.status || undefined,
    error,
  });
}
