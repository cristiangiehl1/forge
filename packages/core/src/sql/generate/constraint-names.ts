function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

export function byteLength(text: string): number {
  let total = 0
  for (const char of text) total += utf8Size(char.codePointAt(0) ?? 0)
  return total
}

export function truncateToBytes(text: string, maxBytes: number): string {
  let total = 0
  let result = ''
  for (const char of text) {
    const size = utf8Size(char.codePointAt(0) ?? 0)
    if (total + size > maxBytes) break
    total += size
    result += char
  }
  return result
}

export function uniqueName(
  base: string,
  used: Set<string>,
  maxBytes: number
): string {
  const truncated = truncateToBytes(base, maxBytes)
  if (!used.has(truncated)) {
    used.add(truncated)
    return truncated
  }
  for (let attempt = 2; ; attempt++) {
    const suffix = `_${attempt}`
    const candidate =
      truncateToBytes(base, maxBytes - byteLength(suffix)) + suffix
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}
