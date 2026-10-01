import type { ColumnType } from '@forge/core'
import {
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
  SIMPLE_COLUMN_KINDS,
} from '@forge/core'

export const COLUMN_KINDS = [
  ...SIMPLE_COLUMN_KINDS,
  'varchar',
  'numeric',
] as const

export type ColumnKind = (typeof COLUMN_KINDS)[number]

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export function defaultColumnType(kind: ColumnKind): ColumnType {
  switch (kind) {
    case 'varchar':
      return { kind: 'varchar', length: 255 }
    case 'numeric':
      return { kind: 'numeric', precision: 10, scale: 2 }
    default:
      return { kind }
  }
}

export function formatColumnType(type: ColumnType): string {
  switch (type.kind) {
    case 'varchar':
      return `varchar(${type.length})`
    case 'numeric':
      return `numeric(${type.precision},${type.scale})`
    default:
      return type.kind
  }
}

export function setVarcharLength(type: ColumnType, value: number): ColumnType {
  if (type.kind !== 'varchar') return type
  return { kind: 'varchar', length: clamp(value, 1, MAX_VARCHAR_LENGTH) }
}

export function setNumericPrecision(
  type: ColumnType,
  value: number
): ColumnType {
  if (type.kind !== 'numeric') return type
  const precision = clamp(value, 1, MAX_NUMERIC_PRECISION)
  return { kind: 'numeric', precision, scale: Math.min(type.scale, precision) }
}

export function setNumericScale(type: ColumnType, value: number): ColumnType {
  if (type.kind !== 'numeric') return type
  return {
    kind: 'numeric',
    precision: type.precision,
    scale: clamp(value, 0, type.precision),
  }
}
