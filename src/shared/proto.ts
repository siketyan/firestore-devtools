/**
 * Helpers for the protobuf-JSON shapes Firestore puts on the wire: resource
 * names and the part of `StructuredQuery` that says what is being read.
 *
 * Everything here is defensive. The payloads come from the network, the SDK
 * version is unknown, and a panel that renders something slightly generic is
 * much better than one that throws.
 */

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
