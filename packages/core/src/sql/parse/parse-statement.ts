import { Cursor } from './cursor.ts'
import { parseCreateTable } from './parse-create-table.ts'
import {
  parseAlterTable,
  parseComment,
  parseCreateDomain,
  parseCreateIndex,
  parseCreateType,
} from './parse-other.ts'
import type { Origin, RawScript } from './raw.ts'
import type { Statement } from './tokenize.ts'

export type Warn = (line: number, message: string) => void

/** A statement on one line, shortened, for messages. */
export function previewOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat
}

function ignored(statement: Statement, warn: Warn): void {
  const words = statement.tokens
    .filter((token) => token.kind === 'word')
    .slice(0, 2)
    .map((token) => token.text.toUpperCase())
    .join(' ')
  warn(
    statement.line,
    `${words || 'This'} statements are not modelled and were ignored.`
  )
}

export function parseStatement(
  statement: Statement,
  sql: string,
  raw: RawScript,
  warn: Warn
): void {
  const cursor = new Cursor(statement.tokens, sql, warn)
  const origin: Origin = {
    line: statement.line,
    text: previewOf(statement.text),
  }

  if (cursor.acceptWord('create')) {
    cursor.acceptWords('or', 'replace')
    cursor.acceptWord('global', 'local', 'temp', 'temporary', 'unlogged')
    if (cursor.acceptWord('table')) {
      const table = parseCreateTable(cursor, origin)
      if (table) raw.tables.push(table)
      return
    }
    const unique = cursor.acceptWord('unique') !== null
    if (cursor.acceptWord('index')) {
      const index = parseCreateIndex(cursor, origin, unique)
      if (index) raw.indexes.push(index)
      return
    }
    if (!unique && cursor.acceptWord('type')) {
      const type = parseCreateType(cursor, origin)
      if (type) raw.types.push(type)
      return
    }
    if (!unique && cursor.acceptWord('domain')) {
      raw.types.push(parseCreateDomain(cursor, origin))
      return
    }
  } else if (cursor.acceptWords('alter', 'table')) {
    parseAlterTable(cursor, origin, raw)
    return
  } else if (cursor.acceptWords('comment', 'on')) {
    const comment = parseComment(cursor, origin)
    if (comment) raw.comments.push(comment)
    return
  }
  ignored(statement, warn)
}
