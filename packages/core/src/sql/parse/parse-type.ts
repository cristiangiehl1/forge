import type { Cursor } from './cursor.ts'
import type { RawType } from './raw.ts'
import { parseOracleType } from './types/oracle.ts'
import { parsePostgresType } from './types/postgres.ts'

/** Reads a column type the way the script's database writes it. */
export function parseColumnType(cursor: Cursor): {
  type: RawType
  serial: boolean
} {
  return cursor.dialect === 'oracle'
    ? parseOracleType(cursor)
    : parsePostgresType(cursor)
}
