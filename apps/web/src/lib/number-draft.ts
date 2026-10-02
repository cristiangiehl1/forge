/**
 * An integer typed into a number field, or null while the text is not a usable
 * number yet (empty, a lone "-", out of range). Out of range is null, not
 * clamped: typing a 0 as the first digit of 120 must not turn into a 1.
 */
export function parseDraft(
  text: string,
  min: number,
  max: number
): number | null {
  const trimmed = text.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= min && value <= max ? value : null
}
