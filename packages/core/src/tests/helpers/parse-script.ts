import { ParseFailure } from '../../sql/parse/cursor.ts'
import { parseStatement } from '../../sql/parse/parse-statement.ts'
import type { RawScript } from '../../sql/parse/raw.ts'
import { emptyScript } from '../../sql/parse/raw.ts'
import { splitStatements, tokenize } from '../../sql/parse/tokenize.ts'

/** Parses a script statement by statement, collecting what a caller would see. */
export function parseScript(sql: string): {
  raw: RawScript
  warnings: string[]
  failures: { line: number; message: string }[]
  lexErrors: { line: number; message: string }[]
} {
  const { tokens, errors } = tokenize(sql)
  const raw = emptyScript()
  const warnings: string[] = []
  const failures: { line: number; message: string }[] = []
  for (const statement of splitStatements(sql, tokens)) {
    try {
      parseStatement(statement, sql, raw, (line, message) => {
        warnings.push(`${line}: ${message}`)
      })
    } catch (error) {
      if (!(error instanceof ParseFailure)) throw error
      failures.push({ line: error.line, message: error.message })
    }
  }
  return { raw, warnings, failures, lexErrors: errors }
}
