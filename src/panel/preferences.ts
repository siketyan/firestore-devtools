import { useCallback, useState } from "react";

/**
 * A panel preference that outlives a reload.
 *
 * `localStorage` is per-extension-origin and never leaves the browser, which
 * is the right home for something this small — but it throws outright when a
 * browser is set to block site data, so every access is guarded.
 */
export function usePersistentFlag(
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => read(key) ?? fallback);

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );

  return [value, set];
}

function read(key: string): boolean | undefined {
  try {
    const stored = localStorage.getItem(key);
    return stored == null ? undefined : stored === "true";
  } catch {
    return undefined;
  }
}

function write(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // A reader who cannot store the preference can still use the panel.
  }
}
