/**
 * Wraps `window.fetch`, which is how the Firestore SDK issues its unary RPCs
 * and, when `useFetchStreams` is on, its streaming ones too.
 */
import { identifyRpc } from "../../shared/firestore";
import type { RpcInfo } from "../../shared/types";
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
      emitEnd(exchangeId, {
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
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
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
