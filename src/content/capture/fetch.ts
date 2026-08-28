/**
 * Wraps `window.fetch`, which is how the Firestore SDK issues its unary RPCs
 * and, when `useFetchStreams` is on, its streaming ones too.
 */
import { identifyRpc } from "../../shared/firestore";
import type { ExchangeEnd, RpcInfo } from "../../shared/types";
import { emitEnd, emitStart, nextId } from "./channel";
import { bodyToText, createResponseSink, emitRequestFrames } from "./payload";

export function patchFetch(): void {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") return;

  window.fetch = async function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request =
      input instanceof Request && !init ? input : new Request(input, init);
    const rpc = identifyRpc(request.url, request.method);

    if (!rpc) {
      return originalFetch.call(this as never, input as RequestInfo, init);
    }

    const exchangeId = nextId("fetch");

    const body =
      bodyToText(init?.body) ??
      (await request
        .clone()
        .text()
        .catch(() => undefined));

    emitStart({ id: exchangeId, rpc, startedAt: Date.now() });
    emitRequestFrames(exchangeId, rpc, body);

    let response: Response;
    try {
      response = await originalFetch.call(
        this as never,
        input as RequestInfo,
        init,
      );
    } catch (error) {
      emitEnd(exchangeId, { finishedAt: Date.now(), ...outcomeOf(error) });
      throw error;
    }

    void drainResponse(exchangeId, rpc, response.clone(), response.status);

    return response;
  } as typeof window.fetch;
}

/**
 * Reads a cloned response to completion in the background, so the messages of
 * a stream surface as they arrive rather than when it finally closes.
 */
async function drainResponse(
  exchangeId: string,
  rpc: RpcInfo,
  response: Response,
  status: number,
): Promise<void> {
  const sink = createResponseSink(exchangeId, rpc);

  try {
    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sink.push(decoder.decode(value, { stream: true }));
      }
      sink.push(decoder.decode());
    } else {
      sink.push(await response.text());
    }

    sink.finish();
    emitEnd(exchangeId, { status, finishedAt: Date.now() });
  } catch (error) {
    sink.finish();
    emitEnd(exchangeId, {
      status,
      finishedAt: Date.now(),
      ...outcomeOf(error),
    });
  }
}

/**
 * How the exchange ended. An abort is the caller changing its mind — the SDK
 * dropping a request on unsubscribe, or the document going away underneath
 * it — which the Network panel reports as cancelled rather than as an error,
 * and so do we. A `TypeError` is indistinguishable from a real network
 * failure here, so it stays one.
 */
function outcomeOf(error: unknown): ExchangeEnd {
  if (error instanceof Error && error.name === "AbortError") {
    return { canceled: true };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}
