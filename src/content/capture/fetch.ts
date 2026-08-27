/**
 * Wraps `window.fetch`, which is how the Firestore SDK issues its unary RPCs
 * and, when `useFetchStreams` is on, its streaming ones too.
 */
import {identifyRpc} from '../../shared/firestore'
import type {ExchangeEnd, RpcInfo} from '../../shared/types'
import {byteLengthOf, emitEnd, emitStart, nextId} from './channel'
import {bodyToText, createResponseSink, emitRequestFrames} from './payload'

export function patchFetch(): void {
  const originalFetch = window.fetch
  if (typeof originalFetch !== 'function') return

  window.fetch = async function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const request =
      input instanceof Request && !init ? input : new Request(input, init)
    const rpc = identifyRpc(request.url, request.method)

    if (!rpc) {
      return originalFetch.call(this as never, input as RequestInfo, init)
    }

    const exchangeId = nextId('fetch')
    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const body =
      bodyToText(init?.body) ??
      (await request
        .clone()
        .text()
        .catch(() => undefined))

    emitStart({
      id: exchangeId,
      pageUrl: location.href,
      url: request.url,
      method: request.method,
      rpc,
      startedAt: Date.now(),
      requestHeaders,
      bytesSent: body ? byteLengthOf(body) : 0
    })
    emitRequestFrames(exchangeId, rpc, body)

    let response: Response
    try {
      response = await originalFetch.call(
        this as never,
        input as RequestInfo,
        init
      )
    } catch (error) {
      emitEnd(exchangeId, {
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    void drainResponse(exchangeId, rpc, response.clone(), {
      status: response.status,
      statusText: response.statusText,
      responseHeaders
    })

    return response
  } as typeof window.fetch
}

/**
 * Reads a cloned response to completion in the background, so the messages of
 * a stream surface as they arrive rather than when it finally closes.
 */
async function drainResponse(
  exchangeId: string,
  rpc: RpcInfo,
  response: Response,
  meta: Pick<ExchangeEnd, 'status' | 'statusText' | 'responseHeaders'>
): Promise<void> {
  const sink = createResponseSink(exchangeId, rpc)
  let bytesReceived = 0

  try {
    const reader = response.body?.getReader()
    if (reader) {
      const decoder = new TextDecoder()
      for (;;) {
        const {done, value} = await reader.read()
        if (done) break
        bytesReceived += value.byteLength
        sink.push(decoder.decode(value, {stream: true}))
      }
      sink.push(decoder.decode())
    } else {
      const text = await response.text()
      bytesReceived = byteLengthOf(text)
      sink.push(text)
    }

    sink.finish()
    emitEnd(exchangeId, {...meta, finishedAt: Date.now(), bytesReceived})
  } catch (error) {
    sink.finish()
    emitEnd(exchangeId, {
      ...meta,
      finishedAt: Date.now(),
      bytesReceived,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
