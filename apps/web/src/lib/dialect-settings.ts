import type { DialectId, DialectOptions } from '@forge/core'

/**
 * What a saved project says about its dialect. A project that is PostgreSQL with
 * no options is saved without it, as it was before dialects existed, until the
 * user chooses something.
 */
export function dialectSettings(
  dialect: DialectId,
  options: DialectOptions
): { dialect?: DialectId; options?: DialectOptions } {
  if (dialect === 'postgres' && Object.keys(options).length === 0) return {}
  return { dialect, options }
}
