import type {CaptureEvent, Exchange} from './types'

export interface ExchangeStoreOptions {
  /** Oldest exchanges are dropped past this count. */
  maxExchanges?: number
  /** Oldest frames of a single exchange are dropped past this count. */
  maxFramesPerExchange?: number
}

/**
 * Ordered collection of captured exchanges, kept in sync by replaying the
 * capture events. The background worker keeps one per tab as a backlog and the
 * panel keeps one as its view model, so the two can never drift apart.
 *
 * Exchanges are mutated in place; subscribers are told *that* something
 * changed via a version counter rather than being handed new objects.
 */
export class ExchangeStore {
  readonly #maxExchanges: number
  readonly #maxFramesPerExchange: number
  readonly #order: Exchange[] = []
  readonly #byId = new Map<string, Exchange>()
  readonly #listeners = new Set<() => void>()
  #version = 0

  constructor(options: ExchangeStoreOptions = {}) {
    this.#maxExchanges = options.maxExchanges ?? 500
    this.#maxFramesPerExchange = options.maxFramesPerExchange ?? 500
  }

  get exchanges(): readonly Exchange[] {
    return this.#order
  }

  get version(): number {
    return this.#version
  }

  get(id: string): Exchange | undefined {
    return this.#byId.get(id)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getVersion = (): number => this.#version

  apply(event: CaptureEvent): void {
    switch (event.kind) {
      case 'start': {
        if (this.#byId.has(event.exchange.id)) return
        const exchange: Exchange = {
          ...event.exchange,
          state: 'pending',
          responseHeaders: {},
          bytesReceived: 0,
          frames: []
        }
        this.#order.push(exchange)
        this.#byId.set(exchange.id, exchange)

        while (this.#order.length > this.#maxExchanges) {
          const evicted = this.#order.shift()
          if (evicted) this.#byId.delete(evicted.id)
        }
        break
      }

      case 'frame': {
        const exchange = this.#byId.get(event.exchangeId)
        if (!exchange) return
        exchange.frames.push(event.frame)
        if (exchange.frames.length > this.#maxFramesPerExchange) {
          exchange.frames.splice(
            0,
            exchange.frames.length - this.#maxFramesPerExchange
          )
        }
        if (exchange.state === 'pending') exchange.state = 'streaming'
        break
      }

      case 'end': {
        const exchange = this.#byId.get(event.exchangeId)
        if (!exchange) return
        Object.assign(exchange, event.patch)
        exchange.state =
          event.patch.error != null || (exchange.status ?? 200) >= 400
            ? 'failed'
            : 'complete'
        break
      }
    }

    this.#bump()
  }

  /** Replaces the contents wholesale, e.g. with the background's backlog. */
  replace(exchanges: readonly Exchange[]): void {
    this.#order.length = 0
    this.#byId.clear()
    for (const exchange of exchanges) {
      this.#order.push(exchange)
      this.#byId.set(exchange.id, exchange)
    }
    this.#bump()
  }

  clear(): void {
    this.#order.length = 0
    this.#byId.clear()
    this.#bump()
  }

  #bump(): void {
    this.#version += 1
    for (const listener of this.#listeners) listener()
  }
}
