import { type Action, ActionIndex } from "./actions";
import type { CaptureEvent, Exchange } from "./types";

/** Oldest exchanges, and oldest frames of one exchange, are dropped past this. */
const MAX = 500;

/**
 * Ordered collection of captured exchanges, kept in sync by replaying the
 * capture events. The background worker keeps one per tab as a backlog and the
 * panel keeps one as its view model, so the two can never drift apart.
 *
 * Alongside the exchanges it maintains the action view of the same traffic —
 * see {@link ActionIndex} — because that projection is built incrementally and
 * has to see the messages in arrival order.
 *
 * Exchanges are mutated in place; what changes on every mutation is the
 * snapshot array holding them, so subscribers have something to compare.
 */
export class ExchangeStore {
  readonly #order: Exchange[] = [];
  readonly #byId = new Map<string, Exchange>();
  readonly #listeners = new Set<() => void>();
  readonly #actions: ActionIndex | undefined;
  /** Rebuilt on every change, so subscribers can compare it by identity. */
  #snapshot: readonly Exchange[] = [];

  /**
   * @param actions whether to maintain the action projection. The background
   * worker only ships exchanges to the panels, so it leaves this off.
   */
  constructor(actions = true) {
    this.#actions = actions ? new ActionIndex() : undefined;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * The current exchanges. The array identity changes on every mutation, and
   * only then, which is what `useSyncExternalStore` needs.
   */
  getSnapshot = (): readonly Exchange[] => this.#snapshot;

  /** The same traffic seen as the actions that produced it. */
  getActions = (): readonly Action[] => this.#actions?.snapshot ?? [];

  apply(event: CaptureEvent): void {
    switch (event.kind) {
      case "start": {
        if (this.#byId.has(event.exchange.id)) return;
        const exchange: Exchange = {
          ...event.exchange,
          state: "pending",
          frames: [],
        };
        this.#order.push(exchange);
        this.#byId.set(exchange.id, exchange);

        while (this.#order.length > MAX) {
          const evicted = this.#order.shift();
          if (evicted) this.#byId.delete(evicted.id);
        }
        break;
      }

      case "frame": {
        const exchange = this.#byId.get(event.exchangeId);
        if (!exchange) return;
        exchange.frames.push(event.frame);
        if (exchange.frames.length > MAX) {
          exchange.frames.splice(0, exchange.frames.length - MAX);
        }
        if (exchange.state === "pending") exchange.state = "streaming";
        this.#actions?.ingest(exchange, event.frame);
        break;
      }

      case "end": {
        const exchange = this.#byId.get(event.exchangeId);
        if (!exchange) return;
        // `canceled` says how the exchange ended rather than being part of it.
        const { canceled, ...patch } = event.patch;
        Object.assign(exchange, patch);
        exchange.state = canceled
          ? "canceled"
          : patch.error != null || (exchange.status ?? 200) >= 400
            ? "failed"
            : "complete";
        this.#actions?.settle(exchange);
        break;
      }
    }

    this.#bump();
  }

  /** Replaces the contents wholesale, e.g. with the background's backlog. */
  replace(exchanges: readonly Exchange[]): void {
    this.#order.length = 0;
    this.#byId.clear();
    for (const exchange of exchanges) {
      this.#order.push(exchange);
      this.#byId.set(exchange.id, exchange);
    }
    this.#actions?.rebuild(this.#order);
    this.#bump();
  }

  clear(): void {
    this.#order.length = 0;
    this.#byId.clear();
    this.#actions?.clear();
    this.#bump();
  }

  #bump(): void {
    this.#snapshot = [...this.#order];
    for (const listener of this.#listeners) listener();
  }
}
