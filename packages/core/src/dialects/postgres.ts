import type { ColumnType } from '../schema/types.ts'
import type { Dialect } from './dialect.ts'

function typeName(type: ColumnType): string {
  switch (type.kind) {
    case 'integer':
      return 'integer'
    case 'bigint':
      return 'bigint'
    case 'text':
      return 'text'
    case 'boolean':
      return 'boolean'
    case 'uuid':
      return 'uuid'
    case 'date':
      return 'date'
    // The logical `timestamp` means an instant in time.
    case 'timestamp':
      return 'timestamptz'
    case 'json':
      return 'jsonb'
    case 'varchar':
      return `varchar(${type.length})`
    case 'numeric':
      return `numeric(${type.precision},${type.scale})`
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

export const postgres: Dialect = {
  id: 'postgres',
  maxIdentifierBytes: 63,
  typeName,
  quoteIdentifier,
}
