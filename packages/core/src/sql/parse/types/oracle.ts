import {
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
} from '../../../schema/types.ts'
import type { Cursor } from '../cursor.ts'
import type { RawType } from '../raw.ts'

const native = (text: string): RawType => ({
  kind: 'native',
  dialect: 'oracle',
  text,
})

/** `(n)` or `(n, m)`; `*` stands for "no precision" and reads as null. */
function readArgs(cursor: Cursor): (number | null)[] {
  if (!cursor.acceptSymbol('(')) return []
  const args: (number | null)[] = []
  do {
    const negative = cursor.acceptSymbol('-')
    const token = cursor.next()
    if (token.kind === 'symbol' && token.value === '*') {
      args.push(null)
    } else if (token.kind === 'number' && /^\d+$/.test(token.value)) {
      args.push(negative ? -Number(token.value) : Number(token.value))
    } else {
      cursor.fail('Expected a whole number in the type.')
    }
  } while (cursor.acceptSymbol(','))
  cursor.expectSymbol(')')
  return args
}

/** A length, with the optional BYTE or CHAR that follows it. */
function readLength(cursor: Cursor, what: string): number {
  cursor.expectSymbol('(')
  const token = cursor.next()
  if (token.kind !== 'number' || !/^\d+$/.test(token.value)) {
    cursor.fail('Expected a whole number in the type.')
  }
  cursor.acceptWord('byte', 'char')
  cursor.expectSymbol(')')
  const length = Number(token.value)
  if (length < 1) cursor.fail(`${what} needs a length of at least 1.`)
  if (length > MAX_VARCHAR_LENGTH) {
    cursor.warn(`A length of ${length} is lowered to ${MAX_VARCHAR_LENGTH}.`)
    return MAX_VARCHAR_LENGTH
  }
  return length
}

/**
 * NUMBER(p) and NUMBER(p,0): the smallest whole-number type that holds p digits.
 * NUMBER(19) is a bigint, as that is what the writer gives one.
 */
function whole(precision: number): RawType {
  if (precision <= 4) return { kind: 'smallint' }
  if (precision <= 9) return { kind: 'integer' }
  if (precision <= 19) return { kind: 'bigint' }
  return { kind: 'numeric', precision, scale: 0 }
}

export function parseOracleType(cursor: Cursor): {
  type: RawType
  serial: boolean
} {
  const first = cursor.peek()
  if (first?.kind !== 'word' && first?.kind !== 'ident') {
    return cursor.fail('Expected a column type.')
  }
  const start = cursor.pos
  const word = first.kind === 'word' ? first.value : null
  const done = (type: RawType) => ({ type, serial: false })

  if (word === 'varchar2' || word === 'varchar') {
    cursor.next()
    if (!cursor.isSymbol('(')) return cursor.fail('VARCHAR2 needs a length.')
    return done({ kind: 'varchar', length: readLength(cursor, 'VARCHAR2') })
  }
  if (word === 'char') {
    cursor.next()
    const length = cursor.isSymbol('(') ? readLength(cursor, 'CHAR') : 1
    return done({ kind: 'char', length })
  }
  if (word === 'clob') {
    cursor.next()
    return done({ kind: 'text' })
  }
  if (word === 'blob') {
    cursor.next()
    return done({ kind: 'bytea' })
  }
  if (word === 'raw') {
    cursor.next()
    const [size] = readArgs(cursor)
    return done(size === 16 ? { kind: 'uuid' } : { kind: 'bytea' })
  }
  if (word === 'number' || word === 'decimal' || word === 'numeric') {
    cursor.next()
    const [precision, scale] = readArgs(cursor)
    if (precision === undefined || precision === null) {
      return done({ kind: 'number' })
    }
    if (precision < 1 || precision > MAX_NUMERIC_PRECISION) {
      return done({ kind: 'number' })
    }
    if (scale === undefined || scale === 0) return done(whole(precision))
    if (scale === null || scale < 0) return done({ kind: 'number' })
    return done({
      kind: 'numeric',
      precision,
      scale: Math.min(scale, precision),
    })
  }
  if (word === 'integer' || word === 'int') {
    cursor.next()
    return done({ kind: 'integer' })
  }
  if (word === 'smallint') {
    cursor.next()
    return done({ kind: 'smallint' })
  }
  if (word === 'float') {
    cursor.next()
    const [precision] = readArgs(cursor)
    return done(
      typeof precision === 'number' && precision <= 24
        ? { kind: 'real' }
        : { kind: 'double' }
    )
  }
  if (word === 'binary_float' || word === 'real') {
    cursor.next()
    return done({ kind: 'real' })
  }
  if (word === 'binary_double') {
    cursor.next()
    return done({ kind: 'double' })
  }
  if (word === 'double') {
    cursor.next()
    cursor.expectWord('precision')
    return done({ kind: 'double' })
  }
  if (word === 'date') {
    cursor.next()
    return done({ kind: 'date' })
  }
  if (word === 'timestamp') {
    cursor.next()
    readArgs(cursor)
    if (cursor.acceptWords('with', 'local', 'time', 'zone')) {
      return done(native('TIMESTAMP WITH LOCAL TIME ZONE'))
    }
    if (cursor.acceptWords('with', 'time', 'zone')) {
      return done({ kind: 'timestamp' })
    }
    return done({ kind: 'timestamp_no_tz' })
  }
  if (word === 'interval') {
    cursor.next()
    if (cursor.acceptWord('day')) {
      readArgs(cursor)
      cursor.expectWord('to')
      cursor.expectWord('second')
      readArgs(cursor)
      return done({ kind: 'interval' })
    }
    if (cursor.acceptWord('year')) {
      readArgs(cursor)
      cursor.expectWord('to')
      cursor.expectWord('month')
      return done(native('INTERVAL YEAR TO MONTH'))
    }
    return cursor.fail('Expected DAY or YEAR after INTERVAL.')
  }

  // Anything else is kept as it is written: the engine does not know it yet.
  cursor.dottedName('a type name')
  if (cursor.isSymbol('(')) cursor.skipBalanced()
  return done(
    native(cursor.slice(start, cursor.pos).replace(/\s+/g, ' ').toUpperCase())
  )
}
