/**
 * What the detail pane shows for an action: the query it asked, and the
 * documents that came back.
 *
 * Both are dug out of the wire payloads on purpose. A request is wrapped in
 * the plumbing that got it there (`addTarget.query.structuredQuery`), and a
 * query's results arrive as one `documentChange` event per document — neither
 * of which is what you opened the panel to read.
 */
import type { Action } from "./actions";
import { asArray, asMessages, asRecord } from "./json";
import { relativePath } from "./proto";
import type { Frame } from "./types";

/**
 * The part of a request worth reading: the structured query, the document
 * names, the writes. Falls back to the whole body when the shape is one we do
 * not recognise.
 */
export function requestPayload(action: Action): unknown {
  const decoded = action.request?.decoded;
  const record = asRecord(decoded);
  if (!record) return decoded;

  const addTarget = asRecord(record.addTarget);
  if (addTarget) {
    const query = asRecord(addTarget.query);
    if (query?.structuredQuery !== undefined) return query.structuredQuery;

    const documents = asRecord(addTarget.documents);
    if (documents?.documents !== undefined) return documents.documents;

    return addTarget;
  }

  if (record.structuredQuery !== undefined) return record.structuredQuery;

  const aggregation = asRecord(record.structuredAggregationQuery);
  if (aggregation !== undefined) return aggregation;

  if (record.writes !== undefined) return record.writes;
  if (record.documents !== undefined) return record.documents;

  return record;
}

/** One document (or write result) an action received. */
export interface ResponseItem {
  id: string;
  /** The document path relative to the database root. */
  path: string;
  timestamp: number;
  byteLength: number;
  /** Everything under `document`, or the write result. */
  body?: unknown;
  /** The document went away, so there is nothing to show. */
  removed: boolean;
}

/** The keys that mark a message as stream bookkeeping rather than a result. */
const EVENT_KEYS = ["targetChange", "filter", "streamId", "noop"];

/**
 * Flattens an action's responses into the documents they carried, so a query
 * with three results reads as three documents rather than three events.
 *
 * A response we cannot read as documents is passed through whole rather than
 * dropped — that is how an error body stays visible.
 */
export function responseItems(action: Action): ResponseItem[] {
  const items: ResponseItem[] = [];

  for (const frame of action.responses) {
    const before = items.length;
    let isEvent = false;

    for (const message of asMessages(frame.decoded)) {
      isEvent ||= EVENT_KEYS.some((key) => key in message);
      collect(message, frame, action, items);
    }

    if (items.length === before && !isEvent) {
      items.push({
        id: frame.id,
        path: frame.label ?? "response",
        timestamp: frame.timestamp,
        byteLength: frame.byteLength,
        body: frame.decoded ?? frame.raw,
        removed: false,
      });
    }
  }

  return items;
}

function collect(
  message: Record<string, unknown>,
  frame: Frame,
  action: Action,
  items: ResponseItem[],
): void {
  const push = (path: string, body: unknown, removed = false): number =>
    items.push({
      id: `${frame.id}-${items.length}`,
      path,
      timestamp: frame.timestamp,
      byteLength: frame.byteLength,
      body,
      removed,
    });

  // A listener's results.
  const change = asRecord(message.documentChange);
  if (change) {
    const document = documentOf(change.document);
    if (document) push(document.path, document.body);
    return;
  }

  const removal = asRecord(message.documentDelete ?? message.documentRemove);
  if (removal) {
    if (typeof removal.document === "string") {
      push(relativePath(removal.document), undefined, true);
    }
    return;
  }

  // A query or batch read over HTTP.
  const result = documentOf(message.document ?? message.found);
  if (result) {
    push(result.path, result.body);
    return;
  }

  if (typeof message.missing === "string") {
    push(relativePath(message.missing), undefined, true);
    return;
  }

  // A single document read, which is the document itself.
  const single = documentOf(message);
  if (single) {
    push(single.path, single.body);
    return;
  }

  // A write's results, which are not documents but are what came back.
  for (const writeResult of asArray(message.writeResults) ?? []) {
    push(action.target, writeResult);
  }
}

function documentOf(
  value: unknown,
): { path: string; body: unknown } | undefined {
  const record = asRecord(value);
  if (typeof record?.name !== "string") return undefined;
  return { path: relativePath(record.name), body: record };
}
