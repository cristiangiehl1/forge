import {
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
} from '../../../schema/types.ts'
import type { Cursor } from '../cursor.ts'
import type { RawType } from '../raw.ts'

const NATIVE: Record<string, RawType> = {
  smallint: { kind: 'smallint' },
  int2: { kind: 'smallint' },
  integer: { kind: 'integer' },
  int: { kind: 'integer' },
  int4: { kind: 'integer' },
  bigint: { kind: 'bigint' },
  int8: { kind: 'bigint' },
  text: { kind: 'text' },
  boolean: { kind: 'boolean' },
  bool: { kind: 'boolean' },
  uuid: { kind: 'uuid' },
  date: { kind: 'date' },
  interval: { kind: 'interval' },
  json: { kind: 'json' },
  jsonb: { kind: 'json' },
  bytea: { kind: 'bytea' },
  real: { kind: 'real' },
  float4: { kind: 'real' },
  float8: { kind: 'double' },
}

const SERIAL: Record<string, RawType> = {
  smallserial: { kind: 'smallint' },
  serial2: { kind: 'smallint' },
  serial: { kind: 'integer' },
  serial4: { kind: 'integer' },
  bigserial: { kind: 'bigint' },
  serial8: { kind: 'bigint' },
}

/** `(n)` or `(n, m)` after a type name; empty when there is none. */
function readNumbers(cursor: Cursor): number[] {
  if (!cursor.acceptSymbol('(')) return []
  const numbers: number[] = []
  do {
    const token = cursor.next()
    if (token.kind !== 'number' || !/^\d+$/.test(token.value)) {
      cursor.fail('Expected a whole number in the type.')
    }
    numbers.push(Number(token.value))
  } while (cursor.acceptSymbol(','))
  cursor.expectSymbol(')')
  return numbers
}

/** A length of at least 1, and at most what PostgreSQL allows. */
function checkLength(cursor: Cursor, length: number): number {
  if (length < 1) cursor.fail('A length must be at least 1.')
  if (length > MAX_VARCHAR_LENGTH) {
    cursor.warn(`A length of ${length} is lowered to ${MAX_VARCHAR_LENGTH}.`)
    return MAX_VARCHAR_LENGTH
  }
  return length
}

function checkPrecision(cursor: Cursor, precision: number): number {
  if (precision < 1) cursor.fail('A precision must be at least 1.')
  if (precision > MAX_NUMERIC_PRECISION) {
    cursor.warn(
      `A precision of ${precision} is lowered to ${MAX_NUMERIC_PRECISION}.`
    )
    return MAX_NUMERIC_PRECISION
  }
  return precision
}

function checkScale(cursor: Cursor, scale: number, precision: number): number {
  if (scale > precision) {
    cursor.warn(
      `A scale of ${scale} is lowered to the precision, ${precision}.`
    )
    return precision
  }
  return scale
}

/** `with time zone` / `without time zone`: whether the zone is kept. */
function readTimeZone(cursor: Cursor): boolean | null {
  if (cursor.acceptWords('with', 'time', 'zone')) return true
  if (cursor.acceptWords('without', 'time', 'zone')) return false
  return null
}

export function parsePostgresType(cursor: Cursor): {
  type: RawType
  serial: boolean
} {
  const first = cursor.peek()
  if (first?.kind !== 'word' && first?.kind !== 'ident') {
    return cursor.fail('Expected a column type.')
  }

  let base: RawType
  let serial = false
  const word = first.kind === 'word' ? first.value : null

  if (word !== null && word in NATIVE) {
    cursor.next()
    base = NATIVE[word] as RawType
  } else if (word !== null && word in SERIAL) {
    cursor.next()
    base = SERIAL[word] as RawType
    serial = true
  } else if (word === 'double') {
    cursor.next()
    cursor.expectWord('precision')
    base = { kind: 'double' }
  } else if (word === 'float') {
    cursor.next()
    const [precision] = readNumbers(cursor)
    base =
      precision !== undefined && precision <= 24
        ? { kind: 'real' }
        : { kind: 'double' }
  } else if (
    word === 'varchar' ||
    word === 'character' ||
    word === 'char' ||
    word === 'bpchar'
  ) {
    cursor.next()
    const varying =
      word === 'varchar' ||
      (word === 'character' && cursor.acceptWord('varying') !== null)
    const [written] = readNumbers(cursor)
    const length =
      written === undefined ? undefined : checkLength(cursor, written)
    if (varying) {
      base =
        length === undefined ? { kind: 'text' } : { kind: 'varchar', length }
    } else {
      base = { kind: 'char', length: length ?? 1 }
    }
  } else if (word === 'numeric' || word === 'decimal') {
    cursor.next()
    const [written, writtenScale] = readNumbers(cursor)
    const precision =
      written === undefined ? undefined : checkPrecision(cursor, written)
    const scale =
      precision === undefined || writtenScale === undefined
        ? writtenScale
        : checkScale(cursor, writtenScale, precision)
    if (precision === undefined) {
      base = { kind: 'number' }
    } else {
      base = { kind: 'numeric', precision, scale: scale ?? 0 }
    }
  } else if (word === 'timestamp' || word === 'timestamptz') {
    cursor.next()
    readNumbers(cursor)
    const zone = word === 'timestamptz' ? true : readTimeZone(cursor)
    base = zone ? { kind: 'timestamp' } : { kind: 'timestamp_no_tz' }
  } else if (word === 'time' || word === 'timetz') {
    cursor.next()
    readNumbers(cursor)
    const zone = word === 'timetz' ? true : readTimeZone(cursor)
    if (zone) cursor.warn('A time zone on a time column is not kept.')
    base = { kind: 'time' }
  } else {
    const { name } = cursor.qualifiedName('a type name')
    readNumbers(cursor)
    base = { kind: 'named', name }
  }

  let isArray = false
  for (;;) {
    if (cursor.acceptSymbol('[')) {
      if (cursor.peek()?.kind === 'number') cursor.next()
      cursor.expectSymbol(']')
      isArray = true
    } else if (cursor.acceptWord('array')) {
      if (cursor.acceptSymbol('[')) {
        if (cursor.peek()?.kind === 'number') cursor.next()
        cursor.expectSymbol(']')
      }
      isArray = true
    } else {
      break
    }
  }
  return { type: isArray ? { kind: 'array', of: base } : base, serial }
}
