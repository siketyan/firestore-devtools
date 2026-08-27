/**
 * Narrowing helpers for the payloads coming off the wire. They are `unknown`
 * until proven otherwise: the SDK version is unknown, and a view that renders
 * something slightly generic beats one that throws inside the panel.
 */

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function asNumbers(value: unknown): number[] {
  return (asArray(value) ?? [])
    .map(asNumber)
    .filter((id): id is number => id != null);
}

/**
 * An inbound WebChannel payload is the proto message wrapped in an array, but
 * a bare object shows up too, so accept both.
 */
export function asMessages(value: unknown): Array<Record<string, unknown>> {
  const entries = asArray(value) ?? [value];
  return entries
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry != null);
}
