import type { ColumnType } from '@forge/core'
import {
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
  SIMPLE_COLUMN_KINDS,
} from '@forge/core'

export const COLUMN_KINDS = [
  ...SIMPLE_COLUMN_KINDS,
  'varchar',
  'char',
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
    case 'char':
      return { kind: 'char', length: 1 }
    case 'numeric':
      return { kind: 'numeric', precision: 10, scale: 2 }
    default:
      return { kind }
  }
}

const KIND_LABELS: Partial<Record<ColumnKind, string>> = {
  timestamp_no_tz: 'timestamp (no tz)',
  double: 'double precision',
}

export const kindLabel = (kind: ColumnKind): string => KIND_LABELS[kind] ?? kind

export function formatColumnType(
  type: ColumnType,
  userTypeName: (typeId: string) => string = (typeId) => typeId
): string {
  switch (type.kind) {
    case 'varchar':
      return `varchar(${type.length})`
    case 'char':
      return `char(${type.length})`
    case 'numeric':
      return `numeric(${type.precision},${type.scale})`
    case 'array':
      return `${formatColumnType(type.of, userTypeName)}[]`
    case 'user':
      return userTypeName(type.typeId)
    default:
      return kindLabel(type.kind)
  }
}

export const baseType = (type: ColumnType): ColumnType =>
  type.kind === 'array' ? baseType(type.of) : type

/** Applies a change to the element of an array, or to the type itself. */
export function mapBase(
  type: ColumnType,
  change: (base: ColumnType) => ColumnType
): ColumnType {
  return type.kind === 'array'
    ? { kind: 'array', of: mapBase(type.of, change) }
    : change(type)
}

export function withArray(type: ColumnType, on: boolean): ColumnType {
  if (on) return type.kind === 'array' ? type : { kind: 'array', of: type }
  return baseType(type)
}

/** The value of the type selector: a kind, or `user:<typeId>`. */
export function choiceOf(type: ColumnType): string {
  const base = baseType(type)
  return base.kind === 'user' ? `user:${base.typeId}` : base.kind
}

export function typeFromChoice(choice: string, asArray: boolean): ColumnType {
  const base: ColumnType = choice.startsWith('user:')
    ? { kind: 'user', typeId: choice.slice('user:'.length) }
    : defaultColumnType(choice as ColumnKind)
  return withArray(base, asArray)
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
