/**
 * Turns the captured wire traffic into the actions a developer actually wrote:
 * a query on a collection, a document read, a listener, a write.
 *
 * The hard part is the WebChannel streams. A `Listen` request goes out on one
 * HTTP exchange and its responses arrive on a different, long-lived one, so
 * the two are only related through the `targetId` the SDK assigns. `Write` is
 * the same story without an id, but the stream is strictly ordered, so its
 * responses are matched to requests first-in-first-out.
 */

import { asArray, asMessages, asNumber, asNumbers, asRecord } from "./json";
import {
  queryCollection,
  relativePath,
  type StructuredQuery,
  summariseQuery,
} from "./proto";
import type { Exchange, Frame } from "./types";

/**
 * What the developer asked for, not how the SDK delivered it. A one-shot
 * `getDocs()` opens a `Listen` target just as `onSnapshot()` does, so the two
 * are the same kind of action here; whether it is still running shows up as
 * the state instead.
 */
export type ActionKind =
  /** Reading a collection. */
  | "query"
  /** Reading a document. */
  | "get"
  /** Creating, updating or deleting. */
  | "write"
  /** Transaction bookkeeping. */
  | "transaction";

export type ActionState = "pending" | "active" | "complete" | "failed";

export interface Action {
  id: string;
  kind: ActionKind;
  /** The collection or document acted on, relative to the database root. */
  target: string;
  /** The query clauses, the write verbs — whatever narrows down the target. */
  detail?: string;
  database?: string;
  /** The WebChannel target id, for the actions that have one. */
  targetId?: number;
  state: ActionState;
  startedAt: number;
  /** When the first response for this action arrived. */
  respondedAt?: number;
  endedAt?: number;
  status?: number;
  error?: string;
  /** The HTTP exchanges that carried this action's messages. */
  exchangeIds: string[];
  request?: Frame;
  responses: Frame[];
  /** Documents the action has seen come back. */
  documentCount: number;
  byteLength: number;
}

export interface ActionIndexOptions {
  maxActions?: number;
  maxResponsesPerAction?: number;
}

/** One `{exchange, frame}` pair, which is all the correlator ever consumes. */
interface Message {
  exchange: Exchange;
  frame: Frame;
}

export class ActionIndex {
  readonly #maxActions: number;
  readonly #maxResponses: number;
  readonly #order: Action[] = [];
  readonly #byId = new Map<string, Action>();
  /** `${database}#${targetId}` -> action id, for the targets still open. */
  readonly #openTargets = new Map<string, string>();
  /** database -> action ids awaiting a write result, oldest first. */
  readonly #pendingWrites = new Map<string, string[]>();
  /** exchange id -> action id, for the one-request-one-response RPCs. */
  readonly #byExchange = new Map<string, string>();
  #snapshot: readonly Action[] = [];
  #sequence = 0;

  constructor(options: ActionIndexOptions = {}) {
    this.#maxActions = options.maxActions ?? 500;
    this.#maxResponses = options.maxResponsesPerAction ?? 500;
  }

  get snapshot(): readonly Action[] {
    return this.#snapshot;
  }

  clear(): void {
    this.#order.length = 0;
    this.#byId.clear();
    this.#openTargets.clear();
    this.#pendingWrites.clear();
    this.#byExchange.clear();
    this.#snapshot = [];
  }

  /** Rebuilds from scratch, replaying every message in the order it arrived. */
  rebuild(exchanges: readonly Exchange[]): void {
    this.clear();

    const messages: Message[] = [];
    for (const exchange of exchanges) {
      for (const frame of exchange.frames) messages.push({ exchange, frame });
    }
    // Frames of one exchange are already ordered, but a stream's responses are
    // interleaved with the requests that arrive on other exchanges.
    messages.sort((a, b) => a.frame.timestamp - b.frame.timestamp);

    for (const message of messages)
      this.ingest(message.exchange, message.frame);
    for (const exchange of exchanges) {
      // A stream that is still open has no outcome to apply yet.
      if (exchange.state === "complete" || exchange.state === "failed") {
        this.settle(exchange);
      }
    }
  }

  ingest(exchange: Exchange, frame: Frame): void {
    if (exchange.rpc.transport === "rest") {
      this.#ingestRest(exchange, frame);
    } else if (exchange.rpc.method === "Listen") {
      this.#ingestListen(exchange, frame);
    } else if (exchange.rpc.method === "Write") {
      this.#ingestWrite(exchange, frame);
    }
    // A frame that belongs to no action — a channel handshake, a keepalive —
    // is not something the developer asked for, so it is simply dropped.

    this.#publish();
  }

  /** Applies an exchange's outcome to the actions it carried. */
  settle(exchange: Exchange): void {
    const unary = this.#byExchange.get(exchange.id);
    if (unary) {
      const action = this.#byId.get(unary);
      if (action) {
        action.status = exchange.status;
        action.error = exchange.error;
        action.endedAt = exchange.finishedAt;
        action.state = failedFrom(exchange) ? "failed" : "complete";
      }
    }

    // A stream that dies takes its open targets with it.
    if (exchange.rpc.transport === "webchannel" && failedFrom(exchange)) {
      for (const [key, actionId] of this.#openTargets) {
        if (!key.startsWith(`${exchange.rpc.database ?? ""}#`)) continue;
        const action = this.#byId.get(actionId);
        if (!action?.exchangeIds.includes(exchange.id)) continue;
        action.state = "failed";
        action.error ??= exchange.error;
        action.endedAt = exchange.finishedAt;
        this.#openTargets.delete(key);
      }
    }

    this.#publish();
  }

  /* ---------------------------------------------------------------- listen */

  #ingestListen(exchange: Exchange, frame: Frame): void {
    const database = exchange.rpc.database ?? "";

    if (frame.direction === "outbound") {
      const request = asRecord(frame.decoded);
      const addTarget = asRecord(request?.addTarget);

      if (addTarget) {
        const targetId = asNumber(addTarget.targetId);
        const action = this.#openTarget(
          exchange,
          frame,
          database,
          targetId,
          addTarget,
        );
        this.#attach(action, exchange, frame);
        action.request = frame;
        return;
      }

      const removeTarget = asNumber(request?.removeTarget);
      if (removeTarget != null) {
        const action = this.#closeTarget(database, removeTarget);
        if (action) {
          this.#attach(action, exchange, frame);
          // The developer unsubscribed; the listener's life is over even
          // though the channel it rode on stays open.
          action.state = action.state === "failed" ? "failed" : "complete";
          action.endedAt = frame.timestamp;
        }
        return;
      }

      return;
    }

    for (const entry of asArray(frame.decoded) ?? []) {
      this.#routeListenResponse(exchange, frame, database, entry);
    }
  }

  /** Returns true when the entry belonged to at least one open target. */
  #routeListenResponse(
    exchange: Exchange,
    frame: Frame,
    database: string,
    entry: unknown,
  ): boolean {
    const record = asRecord(entry);
    if (!record) return false;

    const targetChange = asRecord(record.targetChange);
    if (targetChange) {
      const ids = asNumbers(targetChange.targetIds);
      const actions =
        ids.length > 0
          ? this.#targets(database, ids)
          : this.#allOpenTargets(database);
      if (actions.length === 0) return false;

      const type = String(targetChange.targetChangeType ?? "");
      for (const action of actions) {
        this.#attach(action, exchange, frame);
        if (type === "CURRENT") {
          action.respondedAt ??= frame.timestamp;
          action.state = "active";
        } else if (type === "REMOVE") {
          action.state = targetChange.cause ? "failed" : "complete";
          action.error ??= describeCause(targetChange.cause);
          action.endedAt = frame.timestamp;
          if (action.targetId != null) {
            this.#openTargets.delete(targetKey(database, action.targetId));
          }
        } else if (action.state === "pending") {
          action.state = "active";
        }
      }
      return true;
    }

    const documentChange = asRecord(record.documentChange);
    if (documentChange) {
      const actions = this.#targets(
        database,
        asNumbers(documentChange.targetIds),
      );
      for (const action of actions) {
        this.#attach(action, exchange, frame);
        action.documentCount += 1;
        action.respondedAt ??= frame.timestamp;
      }
      return actions.length > 0;
    }

    const removal = asRecord(record.documentDelete ?? record.documentRemove);
    if (removal) {
      const actions = this.#targets(
        database,
        asNumbers(removal.removedTargetIds),
      );
      for (const action of actions) {
        this.#attach(action, exchange, frame);
        // A delete is a result too; the count has to match the list.
        action.documentCount += 1;
      }
      return actions.length > 0;
    }

    const filter = asRecord(record.filter);
    if (filter) {
      const targetId = asNumber(filter.targetId);
      const actions =
        targetId == null ? [] : this.#targets(database, [targetId]);
      for (const action of actions) this.#attach(action, exchange, frame);
      return actions.length > 0;
    }

    return false;
  }

  #openTarget(
    exchange: Exchange,
    frame: Frame,
    database: string,
    targetId: number | undefined,
    addTarget: Record<string, unknown>,
  ): Action {
    const key = targetId == null ? undefined : targetKey(database, targetId);
    const existing = key
      ? this.#byId.get(this.#openTargets.get(key) ?? "")
      : undefined;
    // The SDK re-sends addTarget with a resume token after a reconnect; that is
    // the same listener, not a new one.
    if (existing) return existing;

    const action = this.#create({
      ...describeTarget(addTarget),
      database: exchange.rpc.database,
      targetId,
      startedAt: frame.timestamp,
    });

    if (key) this.#openTargets.set(key, action.id);
    return action;
  }

  #closeTarget(database: string, targetId: number): Action | undefined {
    const key = targetKey(database, targetId);
    const action = this.#byId.get(this.#openTargets.get(key) ?? "");
    this.#openTargets.delete(key);
    return action;
  }

  #targets(database: string, targetIds: number[]): Action[] {
    const actions: Action[] = [];
    for (const targetId of targetIds) {
      const id = this.#openTargets.get(targetKey(database, targetId));
      const action = id ? this.#byId.get(id) : undefined;
      if (action) actions.push(action);
    }
    return actions;
  }

  #allOpenTargets(database: string): Action[] {
    const actions: Action[] = [];
    for (const [key, id] of this.#openTargets) {
      if (!key.startsWith(`${database}#`)) continue;
      const action = this.#byId.get(id);
      if (action) actions.push(action);
    }
    return actions;
  }

  /* ----------------------------------------------------------------- write */

  #ingestWrite(exchange: Exchange, frame: Frame): void {
    const database = exchange.rpc.database ?? "";

    if (frame.direction === "outbound") {
      const writes = asArray(asRecord(frame.decoded)?.writes);
      // A payload with no writes is the stream handshake.
      if (!writes || writes.length === 0) return;

      const action = this.#create({
        kind: "write",
        ...describeWrites(writes),
        database: exchange.rpc.database,
        startedAt: frame.timestamp,
      });
      this.#attach(action, exchange, frame);
      action.request = frame;

      const queue = this.#pendingWrites.get(database) ?? [];
      queue.push(action.id);
      this.#pendingWrites.set(database, queue);
      return;
    }

    for (const entry of asMessages(frame.decoded)) {
      const results = asArray(entry.writeResults);
      // Anything else is the handshake, which only hands back a stream id.
      if (!results) continue;

      // The write stream is strictly ordered, so the oldest unanswered
      // request is the one this result belongs to.
      const queue = this.#pendingWrites.get(database) ?? [];
      const actionId = queue.shift();
      this.#pendingWrites.set(database, queue);

      const action = actionId ? this.#byId.get(actionId) : undefined;
      if (!action) continue;

      this.#attach(action, exchange, frame);
      action.respondedAt ??= frame.timestamp;
      action.endedAt = frame.timestamp;
      action.state = "complete";
      action.documentCount += results.length;
    }
  }

  /* ------------------------------------------------------------------ rest */

  #ingestRest(exchange: Exchange, frame: Frame): void {
    const action = this.#restActionFor(exchange, frame);
    this.#attach(action, exchange, frame);

    if (frame.direction === "outbound") {
      action.request = frame;
      return;
    }

    action.respondedAt ??= frame.timestamp;
    action.documentCount += countDocuments(frame.decoded);
  }

  #restActionFor(exchange: Exchange, frame: Frame): Action {
    const existing = this.#byId.get(this.#byExchange.get(exchange.id) ?? "");
    if (existing) return existing;

    const request =
      frame.direction === "outbound" ? asRecord(frame.decoded) : undefined;

    const action = this.#create({
      ...describeRest(exchange, request),
      database: exchange.rpc.database,
      startedAt: exchange.startedAt,
    });
    this.#byExchange.set(exchange.id, action.id);
    return action;
  }

  /* ------------------------------------------------------------ bookkeeping */

  #create(
    seed: Omit<
      Action,
      | "id"
      | "state"
      | "exchangeIds"
      | "responses"
      | "documentCount"
      | "byteLength"
    >,
  ): Action {
    this.#sequence += 1;
    const action: Action = {
      ...seed,
      id: `action-${this.#sequence}`,
      state: "pending",
      exchangeIds: [],
      responses: [],
      documentCount: 0,
      byteLength: 0,
    };

    this.#order.push(action);
    this.#byId.set(action.id, action);

    while (this.#order.length > this.#maxActions) {
      const evicted = this.#order.shift();
      if (evicted) this.#forget(evicted);
    }

    return action;
  }

  #forget(action: Action): void {
    this.#byId.delete(action.id);
    for (const [key, id] of this.#openTargets) {
      if (id === action.id) this.#openTargets.delete(key);
    }
    for (const [key, id] of this.#byExchange) {
      if (id === action.id) this.#byExchange.delete(key);
    }
    for (const [database, queue] of this.#pendingWrites) {
      this.#pendingWrites.set(
        database,
        queue.filter((id) => id !== action.id),
      );
    }
  }

  #attach(action: Action, exchange: Exchange, frame: Frame): void {
    if (!action.exchangeIds.includes(exchange.id)) {
      action.exchangeIds.push(exchange.id);
    }
    action.byteLength += frame.byteLength;

    if (frame.direction === "outbound") return;

    action.responses.push(frame);
    if (action.responses.length > this.#maxResponses) {
      action.responses.splice(0, action.responses.length - this.#maxResponses);
    }
    if (action.state === "pending") action.state = "active";
  }

  #publish(): void {
    this.#snapshot = [...this.#order];
  }
}

/* ------------------------------------------------------------- description */

interface Description {
  kind: ActionKind;
  target: string;
  detail?: string;
}

/** What a `Listen` `addTarget` is watching, and which kind of read that is. */
function describeTarget(addTarget: Record<string, unknown>): Description {
  const documents = asRecord(addTarget.documents);
  if (documents) {
    const names = asArray(documents.documents)?.map(String) ?? [];
    const paths = names.map(relativePath);
    return {
      kind: "get",
      target: paths[0] ?? "(documents)",
      detail: paths.length > 1 ? `and ${paths.length - 1} more` : undefined,
    };
  }

  const query = asRecord(addTarget.query);
  const structured = query?.structuredQuery as StructuredQuery | undefined;
  const parent = query?.parent == null ? undefined : String(query.parent);

  return {
    kind: "query",
    target: queryCollection(parent, structured) || "(query)",
    detail: summariseQuery(structured) || undefined,
  };
}

/** What a batch of `Write` operations touches. */
function describeWrites(writes: unknown[]): {
  target: string;
  detail?: string;
} {
  const paths: string[] = [];
  const verbs: string[] = [];

  for (const write of writes) {
    const record = asRecord(write);
    if (!record) continue;

    const update = asRecord(record.update);
    if (update?.name) {
      paths.push(relativePath(String(update.name)));
      verbs.push(record.updateMask ? "update" : "set");
      continue;
    }
    if (record.delete) {
      paths.push(relativePath(String(record.delete)));
      verbs.push("delete");
      continue;
    }
    const transform = asRecord(record.transform);
    if (transform?.document) {
      paths.push(relativePath(String(transform.document)));
      verbs.push("transform");
    }
  }

  const unique = [...new Set(verbs)];
  const extra = paths.length > 1 ? ` and ${paths.length - 1} more` : "";

  return {
    target: paths[0] ?? "(write)",
    detail: `${unique.join(", ") || "write"}${extra}`,
  };
}

/** What an HTTP RPC is asking for. */
function describeRest(
  exchange: Exchange,
  request: Record<string, unknown> | undefined,
): Description {
  const resource = exchange.rpc.resource ?? "";

  switch (exchange.rpc.method) {
    case "RunQuery":
    case "RunAggregationQuery": {
      const structured = (request?.structuredQuery ??
        asRecord(request?.structuredAggregationQuery)?.structuredQuery) as
        | StructuredQuery
        | undefined;
      return {
        kind: "query",
        target: queryCollection(resource, structured) || resource || "(query)",
        detail: summariseQuery(structured) || undefined,
      };
    }

    case "Commit":
    case "BatchWrite": {
      const writes = asArray(request?.writes) ?? [];
      return { kind: "write", ...describeWrites(writes) };
    }

    case "BatchGetDocuments": {
      const names = asArray(request?.documents)?.map(String) ?? [];
      const paths = names.map(relativePath);
      return {
        kind: "get",
        target: paths[0] ?? (resource || "(documents)"),
        detail: paths.length > 1 ? `and ${paths.length - 1} more` : undefined,
      };
    }

    case "ListDocuments":
    case "ListCollectionIds":
      return { kind: "get", target: resource || "(root)" };

    case "BeginTransaction":
    case "Rollback":
      return {
        kind: "transaction",
        target: exchange.rpc.database ?? "(database)",
      };

    default:
      return { kind: "get", target: resource || exchange.rpc.method };
  }
}

function describeCause(cause: unknown): string | undefined {
  const record = asRecord(cause);
  if (!record) return undefined;
  const message = record.message == null ? undefined : String(record.message);
  return message ?? `status ${String(record.code ?? "unknown")}`;
}

/** How many documents an HTTP response carried. */
function countDocuments(decoded: unknown): number {
  const entries = asArray(decoded);
  if (entries) {
    return entries.filter((entry) => {
      const record = asRecord(entry);
      return Boolean(record?.document ?? record?.found ?? record?.missing);
    }).length;
  }

  const record = asRecord(decoded);
  if (!record) return 0;
  if (record.fields || record.name) return 1;
  const documents = asArray(record.documents);
  return documents?.length ?? 0;
}

function failedFrom(exchange: Exchange): boolean {
  return Boolean(exchange.error) || (exchange.status ?? 200) >= 400;
}

function targetKey(database: string, targetId: number): string {
  return `${database}#${targetId}`;
}
