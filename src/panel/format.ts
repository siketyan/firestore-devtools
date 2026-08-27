export function formatBytes(bytes: number | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDuration(ms: number | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const time = date.toLocaleTimeString(undefined, {hour12: false})
  return `${time}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

export function formatJson(value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}
