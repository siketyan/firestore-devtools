/**
 * Helpers for the protobuf-JSON shapes Firestore puts on the wire: resource
 * names, `Value` wrappers, and the part of `StructuredQuery` that says what is
 * being read.
 *
 * Everything here is defensive. The payloads come from the network, the SDK
 * version is unknown, and a panel that renders something slightly generic is
 * much better than one that throws.
 */
import { asArray, asRecord } from "./json";

/** The `projects/p/databases/d/documents/` prefix on every resource name. */
const RESOURCE_PREFIX = /^projects\/[^/]+\/databases\/[^/]+\/documents\/?/;

/**
 * Strips the database prefix off a resource name, so
 * `projects/demo/databases/(default)/documents/users/abc` reads as `users/abc`.
 */
export function relativePath(name: string): string {
  return name.replace(RESOURCE_PREFIX, "");
}

/** Joins a query parent with the collection it selects from. */
function collectionPath(
  parent: string | undefined,
  collectionId: string | undefined,
  allDescendants = false,
): string {
  const base = parent ? relativePath(parent) : "";
  const collection = collectionId ?? "";
  // A collection group query matches the id at any depth, which the SDK and
  // the console both render with a leading `**/`.
  if (allDescendants && collection) return `**/${collection}`;
  return [base, collection].filter(Boolean).join("/");
}

export interface StructuredQuery {
  from?: Array<{ collectionId?: string; allDescendants?: boolean }>;
}

/** The collection a `StructuredQuery` reads from, relative to the database. */
export function queryCollection(
  parent: string | undefined,
  query: StructuredQuery | undefined,
): string {
  const from = query?.from?.[0];
  return collectionPath(parent, from?.collectionId, from?.allDescendants);
}

/**
 * Turns a protobuf-JSON `Value` into the value the app sees, so a document
 * reads as `{"body": "hi"}` rather than as `{"body": {"stringValue": "hi"}}`.
 *
 * Anything that is not a wrapper we know comes back untouched — a shape we
 * cannot read is better shown as it arrived than swallowed.
 */
export function decodeValue(value: unknown): unknown {
  const wrapper = asRecord(value);
  if (!wrapper) return value;

  if ("nullValue" in wrapper) return null;
  if ("booleanValue" in wrapper) return wrapper.booleanValue;
  if ("stringValue" in wrapper) return wrapper.stringValue;
  if ("doubleValue" in wrapper) return wrapper.doubleValue;
  if ("timestampValue" in wrapper) return wrapper.timestampValue;
  if ("bytesValue" in wrapper) return wrapper.bytesValue;

  if ("integerValue" in wrapper) {
    // int64 travels as a string. Reading it back as a number is what the app
    // sees, but only while that is lossless.
    const parsed = Number(wrapper.integerValue);
    return Number.isSafeInteger(parsed) ? parsed : wrapper.integerValue;
  }

  if ("referenceValue" in wrapper) {
    return relativePath(String(wrapper.referenceValue));
  }

  if ("geoPointValue" in wrapper) return wrapper.geoPointValue;

  if ("arrayValue" in wrapper) {
    const array = asRecord(wrapper.arrayValue);
    return (asArray(array?.values) ?? []).map(decodeValue);
  }

  if ("mapValue" in wrapper) {
    const map = asRecord(wrapper.mapValue);
    return decodeFields(map?.fields) ?? {};
  }

  return value;
}

/** A document's `fields` map, with every value unwrapped. */
export function decodeFields(
  fields: unknown,
): Record<string, unknown> | undefined {
  const record = asRecord(fields);
  if (!record) return undefined;

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, decodeValue(value)]),
  );
}

/**
 * A document with its fields unwrapped and its metadata left alone: the name
 * and the timestamps are worth reading exactly as they arrived.
 */
export function decodeDocument(document: unknown): unknown {
  const record = asRecord(document);
  const fields = decodeFields(record?.fields);
  if (!record || !fields) return document;

  return { ...record, fields };
}
