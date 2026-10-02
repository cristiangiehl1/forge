import { INDEX_METHODS } from '../../schema/types.ts'
import type { Cursor } from './cursor.ts'
import {
  parseColumnList,
  parseExpression,
  parseReference,
  skipElement,
} from './parse-create-table.ts'
import { parseColumnType } from './parse-type.ts'
import type {
  Origin,
  RawComment,
  RawDomain,
  RawEnum,
  RawIndex,
  RawScript,
} from './raw.ts'
import type { Token } from './tokenize.ts'

/** Moves to the `,` that separates ALTER TABLE actions (depth 0), or the end. */
function skipAction(cursor: Cursor): void {
  let depth = 0
  while (!cursor.done) {
    const token = cursor.peek() as Token
    if (token.kind === 'symbol') {
      if (token.value === '(' || token.value === '[') depth++
      else if (token.value === ')' || token.value === ']') depth--
      else if (token.value === ',' && depth === 0) return
    }
    cursor.next()
  }
}

/** After `ALTER TABLE`. */
export function parseAlterTable(
  cursor: Cursor,
  origin: Origin,
  raw: RawScript
): void {
  cursor.acceptWords('if', 'exists')
  cursor.acceptWord('only')
  const { name: table } = cursor.qualifiedName('a table name')
  do {
    if (cursor.acceptWord('add')) {
      let constraintName: string | undefined
      if (cursor.acceptWord('constraint')) {
        constraintName = cursor.identifier('a constraint name')
      }
      if (cursor.acceptWords('primary', 'key')) {
        raw.alters.push({ origin, table, primaryKey: parseColumnList(cursor) })
        skipAction(cursor)
      } else if (cursor.acceptWord('unique')) {
        const columns = parseColumnList(cursor)
        raw.alters.push({
          origin,
          table,
          unique:
            constraintName === undefined
              ? { columns }
              : { name: constraintName, columns },
        })
        skipAction(cursor)
      } else if (cursor.acceptWords('foreign', 'key')) {
        const columns = parseColumnList(cursor)
        cursor.expectWord('references')
        raw.alters.push({
          origin,
          table,
          foreignKey: { columns, reference: parseReference(cursor) },
        })
      } else if (cursor.acceptWord('check')) {
        cursor.skipBalanced()
        cursor.warn('A CHECK constraint is not modelled and was ignored.')
        skipAction(cursor)
      } else {
        cursor.warn(
          `ALTER TABLE "${table}" ADD … is not modelled and was ignored.`
        )
        skipAction(cursor)
      }
    } else if (cursor.acceptWord('alter')) {
      cursor.acceptWord('column')
      const column = cursor.identifier('a column name')
      if (cursor.acceptWords('set', 'default')) {
        raw.alters.push({
          origin,
          table,
          setDefault: {
            column,
            expression: parseExpression(cursor, 'DEFAULT'),
          },
        })
      } else if (cursor.acceptWords('add', 'generated')) {
        raw.alters.push({ origin, table, identity: column })
        skipAction(cursor)
      } else {
        cursor.warn(
          `ALTER TABLE "${table}" ALTER COLUMN … is not modelled and was ignored.`
        )
        skipAction(cursor)
      }
    } else {
      const word = cursor.peek()?.text.toUpperCase() ?? ''
      cursor.warn(
        `ALTER TABLE "${table}" ${word} … is not modelled and was ignored.`
      )
      skipAction(cursor)
    }
  } while (cursor.acceptSymbol(','))
}

/** After `CREATE [UNIQUE] INDEX`. Null, with a warning, when it is not a plain index. */
export function parseCreateIndex(
  cursor: Cursor,
  origin: Origin,
  unique: boolean
): RawIndex | null {
  cursor.acceptWord('concurrently')
  cursor.acceptWords('if', 'not', 'exists')
  const name = cursor.isWord('on')
    ? undefined
    : cursor.identifier('an index name')
  cursor.expectWord('on')
  cursor.acceptWord('only')
  const { name: table } = cursor.qualifiedName('a table name')
  let method = 'btree'
  if (cursor.acceptWord('using')) method = cursor.identifier('an index method')

  cursor.expectSymbol('(')
  const columns: string[] = []
  let plain = true
  do {
    const token = cursor.peek()
    const isName = token?.kind === 'word' || token?.kind === 'ident'
    if (isName && !cursor.isSymbol('(', 1)) {
      columns.push(cursor.identifier('a column name'))
      // Anything after the name (ASC, DESC, NULLS …, an operator class) is ordering.
      if (!cursor.isSymbol(',') && !cursor.isSymbol(')')) {
        plain = false
        skipElement(cursor)
      }
    } else {
      plain = false
      skipElement(cursor)
    }
  } while (cursor.acceptSymbol(','))
  cursor.expectSymbol(')')

  let reason: string | null = null
  if (cursor.isWord('include')) reason = 'INCLUDE'
  else if (cursor.isWord('where')) reason = 'a WHERE clause'
  else if (!plain) reason = 'an expression, an ordering or an operator class'
  else if (!(INDEX_METHODS as readonly string[]).includes(method))
    reason = `the "${method}" method`

  if (reason !== null) {
    cursor.warn(
      `Index "${name ?? `on ${table}`}" was ignored: it uses ${reason}, and only plain btree, hash, gin and gist indexes on columns are modelled.`
    )
    return null
  }
  const index: RawIndex = { origin, table, columns, unique, method }
  if (name !== undefined) index.name = name
  return index
}

/** After `CREATE TYPE`. Null, with a warning, for anything but an enum. */
export function parseCreateType(
  cursor: Cursor,
  origin: Origin
): RawEnum | null {
  const { name } = cursor.qualifiedName('a type name')
  if (cursor.acceptWords('as', 'enum')) {
    cursor.expectSymbol('(')
    const values: string[] = []
    if (!cursor.isSymbol(')')) {
      do {
        const token = cursor.next()
        if (token.kind !== 'string') {
          cursor.fail(`Expected a quoted enum value, found "${token.text}".`)
        }
        values.push(token.value)
      } while (cursor.acceptSymbol(','))
    }
    cursor.expectSymbol(')')
    return { origin, kind: 'enum', name, values }
  }
  cursor.warn(
    `Type "${name}" is not an enum and is not modelled; it was ignored.`
  )
  return null
}

/** After `CREATE DOMAIN`. */
export function parseCreateDomain(cursor: Cursor, origin: Origin): RawDomain {
  const { name } = cursor.qualifiedName('a domain name')
  cursor.acceptWord('as')
  const { type } = parseColumnType(cursor)
  const domain: RawDomain = {
    origin,
    kind: 'domain',
    name,
    base: type,
    notNull: false,
  }
  while (!cursor.done) {
    if (cursor.acceptWord('constraint')) {
      cursor.identifier('a constraint name')
    } else if (cursor.acceptWords('not', 'null')) {
      domain.notNull = true
    } else if (cursor.acceptWord('null')) {
      domain.notNull = false
    } else if (cursor.acceptWord('default')) {
      domain.default = parseExpression(cursor, 'DEFAULT')
    } else if (cursor.acceptWord('collate')) {
      cursor.dottedName('a collation')
    } else if (cursor.acceptWord('check')) {
      cursor.skipBalanced()
      cursor.warn(
        `The CHECK of domain "${name}" is not modelled and was ignored.`
      )
    } else {
      cursor.fail(
        `Unexpected "${cursor.peek()?.text ?? ''}" in the definition of domain "${name}".`
      )
    }
  }
  return domain
}

/** After `COMMENT ON`. Null when there is nothing to keep. */
export function parseComment(
  cursor: Cursor,
  origin: Origin
): RawComment | null {
  const kind = cursor.peek()?.value
  if (kind !== 'table' && kind !== 'column') {
    cursor.warn(
      `COMMENT ON ${(cursor.peek()?.text ?? '').toUpperCase()} is not modelled and was ignored.`
    )
    return null
  }
  cursor.next()
  const parts = cursor.dottedName('a name')
  cursor.expectWord('is')
  const token = cursor.next()
  if (token.kind === 'word' && token.value === 'null') return null
  if (token.kind !== 'string') cursor.fail('Expected a quoted comment or NULL.')
  if (kind === 'table') {
    return {
      origin,
      table: parts[parts.length - 1] as string,
      text: token.value,
    }
  }
  if (parts.length < 2)
    cursor.fail('A column comment needs a table and a column.')
  return {
    origin,
    table: parts[parts.length - 2] as string,
    column: parts[parts.length - 1] as string,
    text: token.value,
  }
}
