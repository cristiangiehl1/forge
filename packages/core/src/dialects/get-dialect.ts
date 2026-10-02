import type { Dialect, DialectId, DialectOptions } from './dialect.ts'
import { oracle } from './oracle.ts'
import { postgres } from './postgres.ts'

export function getDialect(
  id: DialectId,
  options: DialectOptions = {}
): Dialect {
  return id === 'oracle' ? oracle(options) : postgres
}
