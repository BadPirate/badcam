export type ByteRange = { start: number; end: number }

/**
 * Parses an HTTP `Range` header for a file of `size` bytes.
 * Returns null when there is no usable single range (serve the whole file),
 * `"unsatisfiable"` when the range lies outside the file (416).
 */
export function parseHttpRange(
  header: string | null | undefined,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, a, b] = m as unknown as [string, string, string]
  if (a === "" && b === "") return null
  if (size <= 0) return "unsatisfiable"
  if (a === "") {
    const n = Number(b)
    if (n === 0) return "unsatisfiable"
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(a)
  if (start >= size) return "unsatisfiable"
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1)
  if (end < start) return null
  return { start, end }
}

export type ContentRange = { start: number; end: number; total: number }

/** Parses `Content-Range: bytes <start>-<end>/<total>` of an upload chunk. */
export function parseContentRange(
  header: string | null | undefined,
): ContentRange | null {
  if (!header) return null
  const m = /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15})$/.exec(header.trim())
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  const total = Number(m[3])
  if (total <= 0 || start > end || end >= total) return null
  return { start, end, total }
}
