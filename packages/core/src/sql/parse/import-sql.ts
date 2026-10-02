import type { Schema } from '../../schema/types.ts'
import { validate } from '../../schema/validate.ts'
import { buildSchema } from './build-schema.ts'
import { ParseFailure } from './cursor.ts'
import { parseStatement, previewOf } from './parse-statement.ts'
import { emptyScript } from './raw.ts'
import { splitStatements, tokenize } from './tokenize.ts'

export interface ImportMessage {
  /** 1-based; 0 for a problem of the whole schema. */
  line: number
  /** The statement it is about, shortened; empty for a lexical problem. */
  statement: string
  message: string
}

export interface ImportResult {
  schema: Schema
  warnings: ImportMessage[]
  errors: ImportMessage[]
}

/**
 * Reads a PostgreSQL script into a schema. What Forge does not model is a
 * warning; a statement it should understand but cannot is an error, and the
 * statements around it are still imported.
 */
export function importSql(sql: string, newId: () => string): ImportResult {
  const warnings: ImportMessage[] = []
  const errors: ImportMessage[] = []
  const seen = new Set<string>()
  const seenErrors = new Set<string>()
  const addError = (message: ImportMessage) => {
    const key = `${message.line}|${message.statement}|${message.message}`
    if (seenErrors.has(key)) return
    seenErrors.add(key)
    errors.push(message)
  }
  const addWarning = (message: ImportMessage) => {
    const key = `${message.line}|${message.statement}|${message.message}`
    if (seen.has(key)) return
    seen.add(key)
    warnings.push(message)
  }

  const { tokens, errors: lexical } = tokenize(sql)
  for (const error of lexical) {
    addError({ line: error.line, statement: '', message: error.message })
  }

  const raw = emptyScript()
  const statements = splitStatements(sql, tokens)
  // Tokenizing stopped at a lexical error, so the last statement may be cut
  // short. The lexical error already says so: the stump is read only to keep it
  // if it happens to be complete, and says nothing of its own.
  const last = tokens[tokens.length - 1]
  const stump =
    lexical.length > 0 && !(last?.kind === 'symbol' && last.value === ';')
      ? statements[statements.length - 1]
      : undefined
  for (const statement of statements) {
    const preview = previewOf(statement.text)
    const isStump = statement === stump
    try {
      parseStatement(
        statement,
        sql,
        raw,
        (line, message) => {
          if (!isStump) addWarning({ line, statement: preview, message })
        },
        preview
      )
    } catch (error) {
      if (isStump && error instanceof ParseFailure) continue
      if (!(error instanceof ParseFailure)) throw error
      addError({
        line: error.line,
        statement: preview,
        message: error.message,
      })
    }
  }

  const schema = buildSchema(raw, newId, (origin, message) => {
    addWarning({ line: origin.line, statement: origin.text, message })
  })
  for (const issue of validate(schema)) {
    addError({ line: 0, statement: '', message: issue.message })
  }
  return { schema, warnings, errors }
}
