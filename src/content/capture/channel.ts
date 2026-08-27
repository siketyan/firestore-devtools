/**
 * The MAIN world half of the capture transport.
 *
 * The interceptor runs in the page's own realm and therefore has no access to
 * `chrome.*`; everything it observes leaves through `window.postMessage`, where
 * `content/bridge.ts` picks it up.
 */
import {
  type CaptureEvent,
  type Direction,
  type ExchangeEnd,
  type ExchangeStart,
  type Frame,
  PAGE_MESSAGE_SOURCE,
  type PageMessage
} from '../../shared/types'

const encoder = new TextEncoder()
let sequence = 0

export function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

export function byteLengthOf(text: string): number {
  return encoder.encode(text).length
}

function emit(event: CaptureEvent): void {
  const message: PageMessage = {source: PAGE_MESSAGE_SOURCE, event}
  // The payload is the page's own traffic, so the page can already see it;
  // `*` keeps this working inside opaque-origin iframes.
  window.postMessage(message, '*')
}

export function emitStart(exchange: ExchangeStart): void {
  emit({kind: 'start', exchange})
}

export function emitFrame(
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

export function emitEnd(exchangeId: string, patch: ExchangeEnd): void {
  emit({kind: 'end', exchangeId, patch})
}
