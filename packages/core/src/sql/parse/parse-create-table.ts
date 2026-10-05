import type { Cursor } from './cursor.ts'
import { parseColumnType } from './parse-type.ts'
import type {
  Origin,
  RawColumn,
  RawHint,
  RawReference,
  RawTable,
} from './raw.ts'
import type { Token } from './tokenize.ts'

/** Words that end a DEFAULT expression written without parentheses. */
const EXPRESSION_STOPS = new Set([
  'not',
  'constraint',
  'primary',
  'unique',
  'references',
  'check',
  'generated',
  'collate',
  'enable',
  'disable',
  'validate',
  'novalidate',
  'using',
])

const CONSTRAINT_STATES = [
  'enable',
  'disable',
  'validate',
  'novalidate',
  'rely',
  'norely',
]

/** `(a, b)` as a list of names. */
export function parseColumnList(cursor: Cursor): string[] {
  cursor.expectSymbol('(')
  const names: string[] = []
  do {
    names.push(cursor.identifier('a column name'))
  } while (cursor.acceptSymbol(','))
  cursor.expectSymbol(')')
  return names
}

/** Moves to the `,` or `)` that ends the element (at depth 0), without consuming it. */
export function skipElement(cursor: Cursor): void {
  let depth = 0
  while (!cursor.done) {
    const token = cursor.peek() as Token
    if (token.kind === 'symbol') {
      if (token.value === '(' || token.value === '[') depth++
      else if (token.value === ')' || token.value === ']') {
        if (depth === 0) return
        depth--
      } else if (token.value === ',' && depth === 0) return
    }
    cursor.next()
  }
}

/** The source text of an expression such as a DEFAULT. */
export function parseExpression(cursor: Cursor, what: string): string {
  const start = cursor.pos
  let depth = 0
  while (!cursor.done) {
    const token = cursor.peek() as Token
    if (token.kind === 'symbol') {
      if (token.value === '(' || token.value === '[') depth++
      else if (token.value === ')' || token.value === ']') {
        if (depth === 0) break
        depth--
      } else if (token.value === ',' && depth === 0) break
    } else if (
      depth === 0 &&
      token.kind === 'word' &&
      cursor.pos > start &&
      (EXPRESSION_STOPS.has(token.value) || token.value === 'null')
    ) {
      break
    }
    cursor.next()
  }
  if (cursor.pos === start) cursor.fail(`Expected an expression after ${what}.`)
  return cursor.slice(start, cursor.pos)
}

/** After `REFERENCES`: the table, its columns and the options that follow. */
export function parseReference(cursor: Cursor): RawReference {
  const { name } = cursor.qualifiedName('a table name')
  const columns = cursor.isSymbol('(') ? parseColumnList(cursor) : []
  let actions = false
  for (;;) {
    if (cursor.acceptWord('match')) {
      cursor.next()
    } else if (cursor.acceptWord('on')) {
      if (!cursor.acceptWord('delete', 'update')) {
        cursor.fail('Expected DELETE or UPDATE after ON.')
      }
      if (cursor.acceptWords('no', 'action')) continue
      const action = cursor.next()
      if (action.value === 'set') {
        cursor.next()
        if (cursor.isSymbol('(')) cursor.skipBalanced()
      }
      actions = true
    } else if (
      cursor.dialect === 'oracle' &&
      cursor.isWord(...CONSTRAINT_STATES)
    ) {
      cursor.next()
    } else if (cursor.isWord('deferrable', 'initially')) {
      const word = cursor.next()
      if (word.value === 'initially') cursor.next()
    } else if (
      cursor.isWord('not') &&
      (cursor.peek(1)?.value === 'deferrable' ||
        cursor.peek(1)?.value === 'valid')
    ) {
      cursor.next()
      cursor.next()
    } else {
      break
    }
  }
  return { table: name, columns, actions }
}

function parseGenerated(cursor: Cursor, column: RawColumn): void {
  if (!cursor.acceptWord('always')) cursor.expectWord('by')
  if (cursor.isWord('default')) cursor.next()
  cursor.acceptWords('on', 'null')
  cursor.expectWord('as')
  if (cursor.acceptWord('identity')) {
    column.generated = true
    column.notNull = true
    if (cursor.isSymbol('(')) cursor.skipBalanced()
  } else {
    cursor.skipBalanced()
    cursor.acceptWord('stored', 'virtual')
    cursor.warn(
      `The generated expression of column "${column.name}" is not modelled; it is imported as a plain column.`
    )
  }
}

function parseColumn(cursor: Cursor, table: RawTable): void {
  const name = cursor.identifier('a column name')
  const { type, serial } = parseColumnType(cursor)
  const column: RawColumn = {
    name,
    type,
    notNull: serial,
    primaryKey: false,
    unique: false,
    generated: serial,
  }
  while (!cursor.done && !cursor.isSymbol(',') && !cursor.isSymbol(')')) {
    if (cursor.acceptWord('constraint')) {
      cursor.identifier('a constraint name')
    } else if (cursor.acceptWords('not', 'null')) {
      column.notNull = true
    } else if (cursor.acceptWord('null')) {
      column.notNull = false
    } else if (cursor.acceptWord('default')) {
      cursor.acceptWords('on', 'null')
      column.default = parseExpression(cursor, 'DEFAULT')
    } else if (cursor.acceptWords('primary', 'key')) {
      column.primaryKey = true
    } else if (cursor.acceptWord('unique')) {
      column.unique = true
    } else if (cursor.acceptWord('references')) {
      column.reference = parseReference(cursor)
    } else if (cursor.acceptWord('check')) {
      const hint = cursor.dialect === 'oracle' ? readCheckHint(cursor) : null
      if (hint === null) {
        if (cursor.dialect !== 'oracle') cursor.skipBalanced()
        cursor.warn('A CHECK constraint is not modelled and was ignored.')
      } else if (hint.column === name) {
        column.hint = hint.hint
      } else {
        table.hints.push(hint)
      }
    } else if (
      cursor.dialect === 'oracle' &&
      cursor.isWord(...CONSTRAINT_STATES)
    ) {
      cursor.next()
    } else if (
      cursor.dialect === 'oracle' &&
      cursor.acceptWords('using', 'index')
    ) {
      skipElement(cursor)
    } else if (cursor.acceptWord('generated')) {
      parseGenerated(cursor, column)
    } else if (cursor.acceptWord('collate')) {
      cursor.dottedName('a collation')
    } else {
      cursor.fail(
        `Unexpected "${cursor.peek()?.text ?? ''}" in the definition of column "${name}".`
      )
    }
  }
  table.columns.push(column)
}

function parseTableConstraint(cursor: Cursor, table: RawTable): void {
  let name: string | undefined
  if (cursor.acceptWord('constraint'))
    name = cursor.identifier('a constraint name')
  if (cursor.acceptWords('primary', 'key')) {
    table.primaryKey = parseColumnList(cursor)
    skipElement(cursor)
  } else if (cursor.acceptWord('unique')) {
    cursor.acceptWords('nulls', 'not', 'distinct')
    const columns = parseColumnList(cursor)
    table.uniques.push(name === undefined ? { columns } : { name, columns })
    skipElement(cursor)
  } else if (cursor.acceptWords('foreign', 'key')) {
    const columns = parseColumnList(cursor)
    cursor.expectWord('references')
    table.foreignKeys.push({ columns, reference: parseReference(cursor) })
  } else if (cursor.acceptWord('check')) {
    const hint = cursor.dialect === 'oracle' ? readCheckHint(cursor) : null
    if (hint === null) {
      if (cursor.dialect !== 'oracle') cursor.skipBalanced()
      cursor.warn('A CHECK constraint is not modelled and was ignored.')
    } else {
      table.hints.push(hint)
    }
    skipElement(cursor)
  } else if (cursor.acceptWord('exclude')) {
    cursor.warn('An EXCLUDE constraint is not modelled and was ignored.')
    skipElement(cursor)
  } else if (cursor.acceptWord('like')) {
    cursor.warn('LIKE is not modelled: the columns it would copy are missing.')
    skipElement(cursor)
  } else {
    cursor.fail(
      `Unexpected "${cursor.peek()?.text ?? ''}" in a table definition.`
    )
  }
}

/** After `CREATE [..] TABLE`. Null (with a warning) when it is not a plain table. */
export function parseCreateTable(
  cursor: Cursor,
  origin: Origin
): RawTable | null {
  cursor.acceptWords('if', 'not', 'exists')
  const { name } = cursor.qualifiedName('a table name')
  if (cursor.isWord('as')) {
    cursor.warn(`CREATE TABLE "${name}" AS … is not modelled and was ignored.`)
    return null
  }
  if (cursor.isWord('partition')) {
    cursor.warn(`Partition "${name}" is not modelled and was ignored.`)
    return null
  }
  if (cursor.isWord('of')) {
    cursor.warn(
      `Typed table "${name}" (OF type) is not modelled and was ignored.`
    )
    return null
  }
  cursor.expectSymbol('(')
  const table: RawTable = {
    origin,
    name,
    columns: [],
    primaryKey: [],
    uniques: [],
    foreignKeys: [],
    hints: [],
  }
  if (!cursor.acceptSymbol(')')) {
    do {
      if (
        cursor.isWord(
          'constraint',
          'primary',
          'unique',
          'foreign',
          'check',
          'exclude',
          'like'
        )
      ) {
        parseTableConstraint(cursor, table)
      } else {
        parseColumn(cursor, table)
      }
    } while (cursor.acceptSymbol(','))
    cursor.expectSymbol(')')
  }
  if (cursor.dialect === 'oracle' && !cursor.done) {
    cursor.warn(
      `The physical clauses of "${name}" (tablespace, storage, ...) are not modelled and were ignored.`
    )
  }
  if (cursor.isWord('inherits', 'partition')) {
    cursor.warn(
      `Inheritance and partitioning of "${name}" are not modelled; it is imported as a plain table.`
    )
  }
  return table
}

/**
 * After `CHECK`, at `(`: reads `col IN (0,1)` as a boolean hint and
 * `col IS JSON [...]` as a json hint, leaving the position after the `)`.
 * Anything else is skipped whole and gives null.
 */
export function readCheckHint(
  cursor: Cursor
): { column: string; hint: RawHint } | null {
  const start = cursor.pos
  cursor.expectSymbol('(')
  const token = cursor.peek()
  if (token?.kind === 'word' || token?.kind === 'ident') {
    const column = cursor.identifier('a column name')
    if (cursor.acceptWords('is', 'json')) {
      let depth = 0
      while (!cursor.done && !(depth === 0 && cursor.isSymbol(')'))) {
        if (cursor.isSymbol('(')) depth++
        else if (cursor.isSymbol(')')) depth--
        cursor.next()
      }
      if (cursor.acceptSymbol(')')) return { column, hint: 'json' }
    } else if (cursor.acceptWord('in') && cursor.acceptSymbol('(')) {
      const first = cursor.next()
      if (cursor.acceptSymbol(',')) {
        const second = cursor.next()
        const zeroOne = [first.value, second.value].sort().join(',') === '0,1'
        if (zeroOne && cursor.acceptSymbol(')') && cursor.acceptSymbol(')')) {
          return { column, hint: 'boolean' }
        }
      }
    }
  }
  cursor.pos = start
  cursor.skipBalanced()
  return null
}
