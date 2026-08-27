/**
 * Helpers for the protobuf-JSON shapes Firestore puts on the wire: resource
 * names, `Value` wrappers and `StructuredQuery`.
 *
 * Everything here is defensive. The payloads come from the network, the SDK
 * version is unknown, and a summary that renders something slightly generic is
 * much better than one that throws in the middle of the panel.
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

/** The collection a document path belongs to: `users/abc/posts/1` -> `users/abc/posts`. */
export function parentCollection(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? path : path.slice(0, separator);
}

/** Joins a query parent with the collection it selects from. */
export function collectionPath(
  parent: string | undefined,
  collectionId: string | undefined,
  allDescendants = false,
): string {
  const base = parent ? relativePath(parent) : "";
  const collection = collectionId ?? "";
  const path = [base, collection].filter(Boolean).join("/");
  // A collection group query matches the id at any depth, which the SDK and
  // the console both render with a leading `**/`.
  return allDescendants && collection ? `**/${collection}` : path;
}

/** Renders a protobuf-JSON `Value` the way a developer would write it. */
export function formatValue(value: unknown): string {
  if (value == null || typeof value !== "object") return String(value);

  const wrapper = value as Record<string, unknown>;

  if ("stringValue" in wrapper) return JSON.stringify(wrapper.stringValue);
  if ("integerValue" in wrapper) return String(wrapper.integerValue);
  if ("doubleValue" in wrapper) return String(wrapper.doubleValue);
  if ("booleanValue" in wrapper) return String(wrapper.booleanValue);
  if ("nullValue" in wrapper) return "null";
  if ("timestampValue" in wrapper) return String(wrapper.timestampValue);
  if ("bytesValue" in wrapper) return "<bytes>";

  if ("referenceValue" in wrapper) {
    return relativePath(String(wrapper.referenceValue));
  }

  if ("geoPointValue" in wrapper) {
    const point = wrapper.geoPointValue as Record<string, unknown> | undefined;
    return `(${point?.latitude ?? 0}, ${point?.longitude ?? 0})`;
  }

  if ("arrayValue" in wrapper) {
    const array = wrapper.arrayValue as { values?: unknown[] } | undefined;
    return `[${(array?.values ?? []).map(formatValue).join(", ")}]`;
  }

  if ("mapValue" in wrapper) {
    const map = wrapper.mapValue as
      | { fields?: Record<string, unknown> }
      | undefined;
    const fields = Object.entries(map?.fields ?? {}).map(
      ([key, field]) => `${key}: ${formatValue(field)}`,
    );
    return `{${fields.join(", ")}}`;
  }

  return JSON.stringify(value);
}

/** Firestore operator enums, as the query builder spells them. */
const FIELD_OPERATORS: Record<string, string> = {
  LESS_THAN: "<",
  LESS_THAN_OR_EQUAL: "<=",
  GREATER_THAN: ">",
  GREATER_THAN_OR_EQUAL: ">=",
  EQUAL: "==",
  NOT_EQUAL: "!=",
  ARRAY_CONTAINS: "array-contains",
  ARRAY_CONTAINS_ANY: "array-contains-any",
  IN: "in",
  NOT_IN: "not-in",
};

const UNARY_OPERATORS: Record<string, string> = {
  IS_NAN: "is NaN",
  IS_NULL: "is null",
  IS_NOT_NAN: "is not NaN",
  IS_NOT_NULL: "is not null",
};

interface FieldReference {
  fieldPath?: string;
}

interface Filter {
  compositeFilter?: { op?: string; filters?: Filter[] };
  fieldFilter?: { field?: FieldReference; op?: string; value?: unknown };
  unaryFilter?: { field?: FieldReference; op?: string };
}

export interface StructuredQuery {
  from?: Array<{ collectionId?: string; allDescendants?: boolean }>;
  where?: Filter;
  orderBy?: Array<{ field?: FieldReference; direction?: string }>;
  limit?: number | { value?: number };
  offset?: number;
}

function formatFilter(filter: Filter | undefined): string | undefined {
  if (!filter) return undefined;

  if (filter.fieldFilter) {
    const { field, op, value } = filter.fieldFilter;
    const operator = op ? (FIELD_OPERATORS[op] ?? op) : "?";
    return `${field?.fieldPath ?? "?"} ${operator} ${formatValue(value)}`;
  }

  if (filter.unaryFilter) {
    const { field, op } = filter.unaryFilter;
    const operator = op ? (UNARY_OPERATORS[op] ?? op) : "?";
    return `${field?.fieldPath ?? "?"} ${operator}`;
  }

  if (filter.compositeFilter) {
    const { op, filters } = filter.compositeFilter;
    const parts = (filters ?? [])
      .map(formatFilter)
      .filter((part): part is string => Boolean(part));
    if (parts.length === 0) return undefined;
    return parts.join(op === "OR" ? " or " : " and ");
  }

  return undefined;
}

/** The clauses of a query, as a single line: `where … · orderBy … · limit …`. */
export function summariseQuery(query: StructuredQuery | undefined): string {
  if (!query) return "";

  const clauses: string[] = [];

  const where = formatFilter(query.where);
  if (where) clauses.push(`where ${where}`);

  const orderBy = (query.orderBy ?? [])
    .map(({ field, direction }) =>
      [field?.fieldPath, direction === "DESCENDING" ? "desc" : undefined]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean);
  if (orderBy.length > 0) clauses.push(`orderBy ${orderBy.join(", ")}`);

  const limit =
    typeof query.limit === "number" ? query.limit : query.limit?.value;
  if (limit != null) clauses.push(`limit ${limit}`);

  if (query.offset) clauses.push(`offset ${query.offset}`);

  return clauses.join(" · ");
}

/** The collection a `StructuredQuery` reads from, relative to the database. */
export function queryCollection(
  parent: string | undefined,
  query: StructuredQuery | undefined,
): string {
  const from = query?.from?.[0];
  return collectionPath(parent, from?.collectionId, from?.allDescendants);
}
