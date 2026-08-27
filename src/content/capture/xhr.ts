/**
 * Wraps `XMLHttpRequest`, which is what the Closure WebChannel used by the
 * `Listen` and `Write` streams is built on.
 */
import {identifyRpc} from '../../shared/firestore'
import type {RpcInfo} from '../../shared/types'
import {byteLengthOf, emitEnd, emitStart, nextId} from './channel'
import {
  bodyToText,
  createResponseSink,
  emitRequestFrames,
  type ResponseSink
} from './payload'

interface XhrState {
  method: string
  url: string
  rpc: RpcInfo
  exchangeId: string
  requestHeaders: Record<string, string>
  sink: ResponseSink
  finished: boolean
}

const xhrStates = new WeakMap<XMLHttpRequest, XhrState>()

export function patchXhr(): void {
  const proto = XMLHttpRequest.prototype
  const originalOpen = proto.open
  const originalSend = proto.send
  const originalSetRequestHeader = proto.setRequestHeader

  proto.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const href = String(url)
    const rpc = identifyRpc(href, method)

    if (rpc) {
      const exchangeId = nextId('xhr')
      xhrStates.set(this, {
        method: method.toUpperCase(),
        // Normalise now, while we still have the document as the base URL.
        url: new URL(href, location.href).toString(),
        rpc,
        exchangeId,
        requestHeaders: {},
        sink: createResponseSink(exchangeId, rpc),
        finished: false
      })
    } else {
      xhrStates.delete(this)
    }

    return (originalOpen as (...args: unknown[]) => void).call(
      this,
      method,
      url,
      ...rest
    )
  } as typeof proto.open

  proto.setRequestHeader = function patchedSetRequestHeader(
    this: XMLHttpRequest,
    name: string,
    value: string
  ) {
    const state = xhrStates.get(this)
    if (state) state.requestHeaders[name] = value
    return originalSetRequestHeader.call(this, name, value)
  }

  proto.send = function patchedSend(this: XMLHttpRequest, body?: unknown) {
    const state = xhrStates.get(this)
    if (!state) return originalSend.call(this, body as XMLHttpRequestBodyInit)

    const text = bodyToText(body)
    emitStart({
      id: state.exchangeId,
      pageUrl: location.href,
      url: state.url,
      method: state.method,
      rpc: state.rpc,
      startedAt: Date.now(),
      requestHeaders: state.requestHeaders,
      bytesSent: text ? byteLengthOf(text) : 0
    })
    emitRequestFrames(state.exchangeId, state.rpc, text)

    // `readystatechange` fires on every flushed chunk while the WebChannel
    // stream is open, which is what makes incremental decoding possible.
    this.addEventListener('readystatechange', () => pump(this))
    this.addEventListener('progress', () => pump(this))
    this.addEventListener('loadend', () => finish(this))
    this.addEventListener('error', () => finish(this, 'Network request failed'))
    this.addEventListener('timeout', () => finish(this, 'Request timed out'))
    this.addEventListener('abort', () => finish(this, 'Request aborted'))

    return originalSend.call(this, body as XMLHttpRequestBodyInit)
  }
}

function readText(xhr: XMLHttpRequest): string | undefined {
  // `responseText` throws when the caller asked for a binary responseType.
  try {
    return xhr.responseType === '' || xhr.responseType === 'text'
      ? xhr.responseText
      : undefined
  } catch {
    return undefined
  }
}

function pump(xhr: XMLHttpRequest): void {
  const state = xhrStates.get(xhr)
  if (!state || state.finished) return
  if (xhr.readyState < XMLHttpRequest.LOADING) return

  const text = readText(xhr)
  if (text != null) state.sink.replace(text)
}

function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return headers
}

function finish(xhr: XMLHttpRequest, error?: string): void {
  const state = xhrStates.get(xhr)
  if (!state || state.finished) return

  pump(xhr)
  state.finished = true

  const text = readText(xhr)
  const streamed = state.sink.finish()

  emitEnd(state.exchangeId, {
    finishedAt: Date.now(),
    status: xhr.status || undefined,
    statusText: xhr.statusText || undefined,
    responseHeaders: parseHeaders(xhr.getAllResponseHeaders?.() ?? ''),
    bytesReceived: streamed || (text ? byteLengthOf(text) : 0),
    error
  })
}
