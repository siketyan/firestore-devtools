/** Joins the truthy class names, so conditional modifiers read cleanly. */
export function classNames(
  ...names: Array<string | false | undefined>
): string {
  return names.filter(Boolean).join(" ");
}

const bytes = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "byte",
  notation: "compact",
  unitDisplay: "narrow",
});

export function formatBytes(value: number | undefined): string {
  return value == null ? "—" : bytes.format(value);
}

export function formatDuration(ms: number | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, { hour12: false });
  return `${time}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function formatJson(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}
