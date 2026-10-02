import type { ParseError } from '@forge/core'

/** The first `max` errors to show, and how many were left out. */
export function summarizeErrors(
  errors: ParseError[],
  max: number
): { shown: ParseError[]; hidden: number } {
  return {
    shown: errors.slice(0, max),
    hidden: Math.max(0, errors.length - max),
  }
}
