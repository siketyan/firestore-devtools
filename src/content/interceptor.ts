/**
 * MAIN world content script.
 *
 * Runs at `document_start` in the page's own realm so that it can wrap `fetch`
 * and `XMLHttpRequest` before the Firebase SDK grabs a reference to them, and
 * see the streaming bodies as they arrive. It has no access to `chrome.*`, so
 * everything it captures is posted to the isolated-world bridge, which relays
 * it to the background worker.
 */
import {identifyRpc} from '../shared/firestore'
import {
  PAGE_MESSAGE_SOURCE,
  type CaptureEvent,
  type Direction,
  type ExchangeEnd,
  type Frame,
  type PageMessage,
  type RpcInfo
} from '../shared/types'
import {
  WebChannelResponseParser,
  describePayload,
  parseWebChannelRequest
} from '../shared/webchannel'

declare global {
  interface Window {
    __firestoreDevtoolsInstalled?: boolean
  }
}

if (!window.__firestoreDevtoolsInstalled) {
  window.__firestoreDevtoolsInstalled = true
  install()
}

function install(): void {
  patchFetch()
  patchXhr()
}

/* ------------------------------------------------------------------ utils */

const encoder = new TextEncoder()
let sequence = 0

function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

function byteLengthOf(text: string): number {
  return encoder.encode(text).length
}

function emit(event: CaptureEvent): void {
  const message: PageMessage = {source: PAGE_MESSAGE_SOURCE, event}
  // The payload is the page's own traffic, so the page can already see it;
  // `*` keeps this working inside opaque-origin iframes.
  window.postMessage(message, '*')
}

function emitFrame(
  exchangeId: string,
  direction: Direction,
  raw: string,
  decoded?: unknown,
  label?: string
): void {
  const frame: Frame = {
    id: nextId('frame'),
    direction,
    timestamp: Date.now(),
    raw,
    decoded,
    label,
    byteLength: byteLengthOf(raw)
  }
  emit({kind: 'frame', exchangeId, frame})
}

function emitEnd(exchangeId: string, patch: ExchangeEnd): void {
  emit({kind: 'end', exchangeId, patch})
}

/** Turns a request body into text, when it is something we can read cheaply. */
function bodyToText(body: unknown): string | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body as ArrayBufferView)
  }
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  return undefined
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Emits the outbound frames for a request body: one per WebChannel message for
 * the streaming RPCs, one JSON document for everything else.
 */
function emitRequestFrames(
  exchangeId: string,
  rpc: RpcInfo,
  body: string | undefined
): void {
  if (!body) return

  if (rpc.transport === 'webchannel') {
    const messages = parseWebChannelRequest(body)
    if (messages.length > 0) {
      for (const message of messages) {
        emitFrame(
          exchangeId,
          'outbound',
          message.raw,
          message.payload,
          describePayload(message.payload)
        )
      }
      return
    }
  }

  const decoded = tryParseJson(body)
  emitFrame(exchangeId, 'outbound', body, decoded, describePayload(decoded))
}

/** Reads a chunk of response text and emits whatever frames it completes. */
function makeResponseSink(exchangeId: string, rpc: RpcInfo) {
  const parser = new WebChannelResponseParser()
  let plainText = ''

  return {
    /** Feeds only the newly arrived text. */
    push(chunk: string): void {
      if (rpc.transport === 'webchannel') {
        for (const message of parser.push(chunk)) {
          emitFrame(
            exchangeId,
            'inbound',
            message.raw,
            message.payload,
            describePayload(message.payload)
          )
        }
      } else {
        plainText += chunk
      }
    },
    /** Feeds the whole response body seen so far. */
    replace(fullText: string): void {
      if (rpc.transport === 'webchannel') {
        for (const message of parser.replace(fullText)) {
          emitFrame(
            exchangeId,
            'inbound',
            message.raw,
            message.payload,
            describePayload(message.payload)
          )
        }
      } else {
        plainText = fullText
      }
    },
    /** Flushes the buffered unary body as a single frame. */
    finish(): number {
      if (rpc.transport === 'webchannel' || !plainText) return 0
      const decoded = tryParseJson(plainText)
      emitFrame(
        exchangeId,
        'inbound',
        plainText,
        decoded,
        describePayload(decoded)
      )
      return byteLengthOf(plainText)
    }
  }
}

/* ------------------------------------------------------------------ fetch */

function patchFetch(): void {
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

    emit({
      kind: 'start',
      exchange: {
        id: exchangeId,
        pageUrl: location.href,
        url: request.url,
        method: request.method,
        rpc,
        startedAt: Date.now(),
        requestHeaders,
        bytesSent: body ? byteLengthOf(body) : 0
      }
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

async function drainResponse(
  exchangeId: string,
  rpc: RpcInfo,
  response: Response,
  meta: Pick<ExchangeEnd, 'status' | 'statusText' | 'responseHeaders'>
): Promise<void> {
  const sink = makeResponseSink(exchangeId, rpc)
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

/* -------------------------------------------------------------------- xhr */

interface XhrState {
  method: string
  url: string
  rpc: RpcInfo
  exchangeId: string
  requestHeaders: Record<string, string>
  sink: ReturnType<typeof makeResponseSink>
  finished: boolean
}

const xhrStates = new WeakMap<XMLHttpRequest, XhrState>()

function patchXhr(): void {
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
        sink: makeResponseSink(exchangeId, rpc),
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
    emit({
      kind: 'start',
      exchange: {
        id: state.exchangeId,
        pageUrl: location.href,
        url: state.url,
        method: state.method,
        rpc: state.rpc,
        startedAt: Date.now(),
        requestHeaders: state.requestHeaders,
        bytesSent: text ? byteLengthOf(text) : 0
      }
    })
    emitRequestFrames(state.exchangeId, state.rpc, text)

    // `readystatechange` fires on every flushed chunk while the WebChannel
    // stream is open, which is what makes incremental decoding possible.
    this.addEventListener('readystatechange', () => pumpXhr(this))
    this.addEventListener('progress', () => pumpXhr(this))
    this.addEventListener('loadend', () => finishXhr(this))
    this.addEventListener('error', () =>
      finishXhr(this, 'Network request failed')
    )
    this.addEventListener('timeout', () => finishXhr(this, 'Request timed out'))
    this.addEventListener('abort', () => finishXhr(this, 'Request aborted'))

    return originalSend.call(this, body as XMLHttpRequestBodyInit)
  }
}

function readXhrText(xhr: XMLHttpRequest): string | undefined {
  // `responseText` throws when the caller asked for a binary responseType.
  try {
    return xhr.responseType === '' || xhr.responseType === 'text'
      ? xhr.responseText
      : undefined
  } catch {
    return undefined
  }
}

function pumpXhr(xhr: XMLHttpRequest): void {
  const state = xhrStates.get(xhr)
  if (!state || state.finished) return
  if (xhr.readyState < XMLHttpRequest.LOADING) return

  const text = readXhrText(xhr)
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

function finishXhr(xhr: XMLHttpRequest, error?: string): void {
  const state = xhrStates.get(xhr)
  if (!state || state.finished) return

  pumpXhr(xhr)
  state.finished = true

  const text = readXhrText(xhr)
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
