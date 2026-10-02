# SQL parser (sub-project 2 of SQL import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `importSql(sql, newId)` in `@forge/core` turns a PostgreSQL script into a `Schema` (tables, columns, primary keys, foreign keys, indexes, comments, defaults, enums, domains) plus warnings for what Forge does not model and errors for statements it cannot read.

**Architecture:** A hand-written pipeline, no dependencies: a tokenizer (with line numbers and source offsets) → a statement splitter → one small recursive-descent parser per statement kind, each producing plain "raw" records → a builder that assigns ids, resolves names, applies Forge's own relationship rules and validates. Every layer is a pure function and tested on its own.

**Tech Stack:** TypeScript 7 with `node:test` and type stripping, Biome. Platform-free (no DOM, no Node APIs, no dependencies).

**Spec:** `docs/superpowers/specs/2026-10-02-sql-import-design.md` (section 2, "Parser"). The model it fills was built in `docs/superpowers/plans/2026-10-02-model-additions.md` (already on `main`). The import dialog (sub-project 3) is a separate plan.

## Global Constraints

- Run Node through mise: prefix every command with `export PATH="$(mise where node)/bin:$PATH"`. Use absolute paths. Run commands from `/home/cristian.giehl@koch.intranet/orca/projects/forge`. Without the mise PATH, `node --test` has no type stripping and every test fails.
- Tests live in `packages/core/src/tests/unit/**` and `packages/core/src/tests/integration/**`, never colocated. Command: `pnpm --filter @forge/core test`. Style: `pnpm exec biome check --write packages` (single quotes, no semicolons, 2 spaces, width 80). Never put a comment inside `biome.json`.
- The core is platform-free and has no dependencies. Code goes under `packages/core/src/sql/parse/`.
- Work on a branch (`feat/sql-parser`), not `main`. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.
- Unquoted SQL identifiers fold to lower case (as PostgreSQL does); quoted ones keep their case. Keywords are matched case-insensitively.
- Forge's own rules decide which foreign keys are kept: use `checkRelationship` and `validate` from `schema/validate.ts`, do not re-implement them.
- A statement Forge does not model is a **warning** (with its line) and is skipped. A syntax error inside a statement Forge should understand is an **error** for that statement; the other statements are still parsed.

## Rulings made while planning

- **`importSql` returns three things**: `{ schema, warnings, errors }`. A script with errors still returns the schema built from the statements that parsed; the caller (sub-project 3) disables Import when `errors` is not empty.
- **`serial`/`bigserial`, identity columns, `nextval(...)` defaults on integers, `now()`/`CURRENT_TIMESTAMP` on a timestamp, and `gen_random_uuid()`/`uuid_generate_v4()` on a uuid** all become `generated: true`. Any other default stays raw in `default`.
- **`smallint` identity or serial** cannot be `generated` in Forge (only integer, bigint, uuid and timestamp can): it is imported as a plain `smallint NOT NULL` with a warning.
- **Unknown or unsupported type names** (`money`, `inet`, `xml`, …) are imported as `text` with a warning. `varchar` without a length is `text`. `numeric` without precision is `numeric(38,10)` with a warning. Multi-dimensional arrays are one array level.
- **A `UNIQUE` constraint becomes a unique index** named after its constraint (`CONSTRAINT users_email_key UNIQUE (email)` → index `users_email_key`), or `uq_<table>_<columns>` when unnamed. A second unique index on the same columns is skipped.
- **Referential actions** (`ON DELETE CASCADE`, …) are not modelled: the foreign key is kept and one warning says the actions were ignored.
- **`COPY … FROM stdin;` data blocks** (up to the line `\.`) and psql meta-commands (lines starting with a backslash) are skipped by the tokenizer without a message.
- **Duplicate names** (two tables, two types, two columns of a table) keep the first and warn.

## Review Focus

Inputs a real script has that no single task's happy path covers (each gets a test in the task that owns the code):

1. A `pg_dump`-style script: `SET` lines, `COPY … FROM stdin` data with tabs and semicolons, `\.`, comments, `CREATE EXTENSION`, `ALTER … OWNER TO`, `CREATE SEQUENCE` plus `nextval` defaults, `ALTER TABLE ONLY … ADD CONSTRAINT` (Task 6).
2. Semicolons and keywords inside strings, dollar-quoted bodies and comments never split or confuse statements (Task 1).
3. Identifier case: `Users` unquoted and `"Users"` quoted are different names (Task 1, Task 5).
4. A foreign key to a table defined later in the script, to an unknown table or column, to a non-primary-key column, or composite, is dropped with a warning, never a crash (Task 5).
5. What Forge generates reads back to the same schema (round-trip), including enums, domains, indexes, comments and defaults (Task 6).
6. A truncated script (unterminated string, comment or parenthesis) is reported as an error with its line, and the statements before it still import (Task 1, Task 3).
7. Empty input and input with only comments give an empty schema and no messages (Task 5).

---

### Task 1: Tokenizer and statement splitter

**Files:**
- Create: `packages/core/src/sql/parse/tokenize.ts`
- Test: `packages/core/src/tests/unit/sql/parse/tokenize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later task):
  - `type TokenKind = 'word' | 'ident' | 'string' | 'number' | 'symbol'`
  - `interface Token { kind: TokenKind; text: string; value: string; line: number; start: number; end: number }` where `text` is the source text, `value` is: lower-cased for `word`, unquoted (`""` collapsed) for `ident`, the decoded content for `string` (quotes removed, `''` collapsed, `E'…'` backslash escapes and dollar-quoted bodies decoded), the digits for `number`, the symbol for `symbol`. `start`/`end` are offsets into the source (`end` exclusive); `line` is 1-based.
  - `interface LexError { line: number; message: string }`
  - `tokenize(sql: string): { tokens: Token[]; errors: LexError[] }`
  - `interface Statement { tokens: Token[]; line: number; text: string }` (`tokens` excludes the `;`; `text` is the source slice)
  - `splitStatements(sql: string, tokens: Token[]): Statement[]`
- Behaviour: comments (`--…`, nested `/* … */`) and whitespace are skipped; symbols are single characters except `::`; a line starting with `\` (psql meta-command) is skipped; after a statement that starts with `COPY` and contains the word `stdin`, everything up to and including the line `\.` is skipped; an unterminated string, quoted identifier, dollar quote or block comment adds a `LexError` and stops tokenizing.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/tests/unit/sql/parse/tokenize.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { splitStatements, tokenize } from '../../../../sql/parse/tokenize.ts'

const values = (sql: string) => tokenize(sql).tokens.map((token) => token.value)
const kinds = (sql: string) => tokenize(sql).tokens.map((token) => token.kind)

describe('tokenize: words, identifiers, numbers and symbols', () => {
  it('lower-cases words, keeps the case of quoted identifiers, and unescapes ""', () => {
    assert.deepEqual(values('Create TABLE "Users" ("a""b")'), [
      'create',
      'table',
      'Users',
      '(',
      'a"b',
      ')',
    ])
    assert.deepEqual(kinds('Create "x" 12'), ['word', 'ident', 'number'])
  })

  it('reads numbers with decimals and exponents', () => {
    assert.deepEqual(values('1 2.5 .5 1e10 3E-2'), ['1', '2.5', '.5', '1e10', '3E-2'])
  })

  it('reads :: as one symbol and every other symbol alone', () => {
    assert.deepEqual(values("a::int[],(x)"), ['a', '::', 'int', '[', ']', ',', '(', 'x', ')'])
  })

  it('keeps offsets and lines', () => {
    const { tokens } = tokenize('a\n  bb')
    assert.deepEqual(
      tokens.map((t) => [t.text, t.line, t.start, t.end]),
      [
        ['a', 1, 0, 1],
        ['bb', 2, 4, 6],
      ]
    )
  })
})

describe('tokenize: strings', () => {
  it('collapses doubled quotes and keeps semicolons and keywords inside', () => {
    const { tokens } = tokenize("'it''s; CREATE TABLE'")
    assert.equal(tokens.length, 1)
    assert.equal(tokens[0]?.kind, 'string')
    assert.equal(tokens[0]?.value, "it's; CREATE TABLE")
  })

  it('decodes E-strings and reads dollar-quoted bodies whole', () => {
    assert.deepEqual(values("E'a\\'b\\n'"), ["a'b\n"])
    assert.deepEqual(values('$$ x; y $$'), [' x; y '])
    assert.deepEqual(values('$tag$ a $$ b $tag$'), [' a $$ b '])
  })

  it('spans lines inside a string and counts them', () => {
    const { tokens } = tokenize("'a\nb' x")
    assert.equal(tokens[1]?.line, 2)
  })
})

describe('tokenize: comments, meta-commands and COPY data', () => {
  it('skips line comments and nested block comments, counting lines', () => {
    const { tokens, errors } = tokenize('a -- x; y\n/* one /* two */ still */ b')
    assert.deepEqual(errors, [])
    assert.deepEqual(
      tokens.map((t) => [t.value, t.line]),
      [
        ['a', 1],
        ['b', 2],
      ]
    )
  })

  it('skips psql meta-command lines', () => {
    assert.deepEqual(values('\\connect db\nselect 1'), ['select', '1'])
  })

  it('skips the data of COPY … FROM stdin up to \\. and keeps what follows', () => {
    const sql = 'COPY t (a) FROM stdin;\n1\tx;y\n2\tz\n\\.\n\nselect 2;'
    const result = tokenize(sql)
    assert.deepEqual(
      result.tokens.map((t) => t.value),
      ['copy', 't', '(', 'a', ')', 'from', 'stdin', ';', 'select', '2', ';']
    )
    assert.equal(result.tokens.find((t) => t.value === 'select')?.line, 6)
  })

  it('does not skip anything for a COPY that is not from stdin', () => {
    assert.deepEqual(values("COPY t TO '/tmp/x';\nselect 1"), [
      'copy', 't', 'to', '/tmp/x', ';', 'select', '1',
    ])
  })
})

describe('tokenize: truncated input', () => {
  it('reports an unterminated string, identifier, dollar quote and comment with their line', () => {
    for (const sql of ["select 'abc", 'select "abc', 'select $$abc', 'select /* abc']) {
      const { errors } = tokenize(`\n${sql}`)
      assert.equal(errors.length, 1, sql)
      assert.equal(errors[0]?.line, 2, sql)
    }
  })

  it('keeps the tokens read before the problem', () => {
    assert.deepEqual(values("select 1; select 'x"), ['select', '1', ';', 'select'])
  })
})

describe('splitStatements', () => {
  const split = (sql: string) => splitStatements(sql, tokenize(sql).tokens)

  it('splits at semicolons, drops empty statements and keeps the last one without a semicolon', () => {
    const statements = split(';; select 1;\n\nselect 2')
    assert.deepEqual(
      statements.map((s) => [s.line, s.text, s.tokens.length]),
      [
        [1, 'select 1', 2],
        [3, 'select 2', 2],
      ]
    )
  })

  it('does not split inside strings, comments or dollar-quoted bodies', () => {
    assert.equal(split("select 'a;b'; -- ;\nselect $$ ; $$").length, 2)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/sql/parse/tokenize.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE"`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tokenize.ts`.

- [ ] **Step 3: Implement `tokenize.ts`**

```ts
export type TokenKind = 'word' | 'ident' | 'string' | 'number' | 'symbol'

export interface Token {
  kind: TokenKind
  /** The source text. */
  text: string
  /**
   * Words are lower-cased, quoted identifiers unquoted, strings decoded;
   * numbers and symbols are their text.
   */
  value: string
  line: number
  start: number
  end: number
}

export interface LexError {
  line: number
  message: string
}

export interface Statement {
  tokens: Token[]
  line: number
  text: string
}

const isDigit = (c: string | undefined): boolean =>
  c !== undefined && c >= '0' && c <= '9'
const isWordStart = (c: string | undefined): boolean =>
  c !== undefined && (/[A-Za-z_]/.test(c) || c > '\u007f')
const isWordPart = (c: string | undefined): boolean =>
  c !== undefined && (/[A-Za-z0-9_$]/.test(c) || c > '\u007f')

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }

export function tokenize(sql: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = []
  const errors: LexError[] = []
  const length = sql.length
  let i = 0
  let line = 1
  let first: Token | undefined
  let sawStdin = false

  const countLines = (from: number, to: number) => {
    for (let at = from; at < to; at++) if (sql[at] === '\n') line++
  }
  const push = (
    kind: TokenKind,
    start: number,
    end: number,
    value: string,
    startLine: number
  ) => {
    const token: Token = {
      kind,
      text: sql.slice(start, end),
      value,
      line: startLine,
      start,
      end,
    }
    tokens.push(token)
    first ??= token
    if (kind === 'word' && value === 'stdin') sawStdin = true
    return token
  }
  const fail = (message: string, at: number) => {
    errors.push({ line, message })
    i = length
    return at
  }

  while (i < length) {
    const c = sql[i] as string

    if (c === '\n') {
      line++
      i++
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '\\' && /^[ \t]*$/.test(sql.slice(sql.lastIndexOf('\n', i - 1) + 1, i))) {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? length : end
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? length : end
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const startLine = line
      let depth = 1
      let at = i + 2
      while (at < length && depth > 0) {
        if (sql[at] === '/' && sql[at + 1] === '*') {
          depth++
          at += 2
        } else if (sql[at] === '*' && sql[at + 1] === '/') {
          depth--
          at += 2
        } else {
          if (sql[at] === '\n') line++
          at++
        }
      }
      if (depth > 0) {
        errors.push({ line: startLine, message: 'A comment is never closed.' })
        i = length
      } else {
        i = at
      }
      continue
    }

    const startLine = line
    const start = i

    // 'text' and E'text'
    const escapeString =
      (c === 'E' || c === 'e') && sql[i + 1] === "'" && !isWordPart(sql[i - 1])
    if (c === "'" || escapeString) {
      let at = escapeString ? i + 2 : i + 1
      let value = ''
      let closed = false
      while (at < length) {
        const d = sql[at] as string
        if (d === "'" && sql[at + 1] === "'") {
          value += "'"
          at += 2
        } else if (d === "'") {
          closed = true
          at++
          break
        } else if (escapeString && d === '\\' && at + 1 < length) {
          const next = sql[at + 1] as string
          value += ESCAPES[next] ?? next
          at += 2
        } else {
          if (d === '\n') line++
          value += d
          at++
        }
      }
      if (!closed) {
        errors.push({ line: startLine, message: 'A string is never closed.' })
        i = length
        continue
      }
      push('string', start, at, value, startLine)
      i = at
      continue
    }

    // "identifier"
    if (c === '"') {
      let at = i + 1
      let value = ''
      let closed = false
      while (at < length) {
        const d = sql[at] as string
        if (d === '"' && sql[at + 1] === '"') {
          value += '"'
          at += 2
        } else if (d === '"') {
          closed = true
          at++
          break
        } else {
          if (d === '\n') line++
          value += d
          at++
        }
      }
      if (!closed) {
        errors.push({ line: startLine, message: 'A quoted name is never closed.' })
        i = length
        continue
      }
      push('ident', start, at, value, startLine)
      i = at
      continue
    }

    // $tag$ … $tag$
    if (c === '$') {
      const open = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64))
      if (open) {
        const tag = open[0]
        const close = sql.indexOf(tag, i + tag.length)
        if (close === -1) {
          errors.push({ line: startLine, message: 'A $-quoted string is never closed.' })
          i = length
          continue
        }
        const value = sql.slice(i + tag.length, close)
        countLines(i, close)
        push('string', start, close + tag.length, value, startLine)
        i = close + tag.length
        continue
      }
    }

    if (isDigit(c) || (c === '.' && isDigit(sql[i + 1]))) {
      let at = i
      while (isDigit(sql[at])) at++
      if (sql[at] === '.' && isDigit(sql[at + 1] ?? '')) {
        at++
        while (isDigit(sql[at])) at++
      } else if (sql[at] === '.' && at > i && !isWordStart(sql[at + 1])) {
        at++
      }
      if ((sql[at] === 'e' || sql[at] === 'E') && (isDigit(sql[at + 1]) || ((sql[at + 1] === '-' || sql[at + 1] === '+') && isDigit(sql[at + 2])))) {
        at += 2
        while (isDigit(sql[at])) at++
      }
      push('number', start, at, sql.slice(start, at), startLine)
      i = at
      continue
    }

    if (isWordStart(c)) {
      let at = i + 1
      while (isWordPart(sql[at])) at++
      const text = sql.slice(start, at)
      push('word', start, at, text.toLowerCase(), startLine)
      i = at
      continue
    }

    if (c === ':' && sql[i + 1] === ':') {
      push('symbol', start, i + 2, '::', startLine)
      i += 2
      continue
    }

    push('symbol', start, i + 1, c, startLine)
    i++

    // After `COPY … FROM stdin;` the lines up to `\.` are data, not SQL.
    if (c === ';') {
      if (first?.value === 'copy' && sawStdin) {
        const end = sql.indexOf('\n\\.', i)
        const stop = end === -1 ? length : end + 3
        countLines(i, stop)
        i = stop
      }
      first = undefined
      sawStdin = false
    }
  }
  void fail
  return { tokens, errors }
}

export function splitStatements(sql: string, tokens: Token[]): Statement[] {
  const statements: Statement[] = []
  let current: Token[] = []
  const finish = () => {
    const firstToken = current[0]
    const lastToken = current[current.length - 1]
    if (firstToken && lastToken) {
      statements.push({
        tokens: current,
        line: firstToken.line,
        text: sql.slice(firstToken.start, lastToken.end),
      })
    }
    current = []
  }
  for (const token of tokens) {
    if (token.kind === 'symbol' && token.value === ';') finish()
    else current.push(token)
  }
  finish()
  return statements
}
```

Delete the unused `fail` helper and the `void fail` line if Biome flags them (it is a leftover from drafting; the error handling above pushes to `errors` directly). Run `pnpm exec biome check --write packages` to format.

- [ ] **Step 4: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write packages 2>&1 | tail -2; pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"`
Expected: all pass. Fix the implementation, not the tests, for any failure (the number rule `1.` followed by a word, and the `E` prefix after a word character, are the usual suspects).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): tokenize and split SQL scripts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cursor and column types

**Files:**
- Create: `packages/core/src/sql/parse/raw.ts`, `packages/core/src/sql/parse/cursor.ts`, `packages/core/src/sql/parse/parse-type.ts`
- Test: `packages/core/src/tests/unit/sql/parse/parse-type.test.ts`
- Create (test helper): `packages/core/src/tests/helpers/parse-script.ts` is added in Task 3; this task builds its own tiny helper inside the test file.

**Interfaces:**
- Consumes: Task 1 `Token`, `tokenize`.
- Produces:
  - `raw.ts`: `Origin = { line: number; text: string }`; `RawType = Exclude<ColumnType, { kind: 'array' } | { kind: 'user' }> | { kind: 'named'; name: string } | { kind: 'array'; of: RawType }`; `RawReference = { table: string; columns: string[]; actions: boolean }`; `RawColumn`, `RawTable`, `RawIndex`, `RawEnum`, `RawDomain`, `RawComment`, `RawAlter`, `RawScript`, `emptyScript(): RawScript` (defined in Task 3's step for tables; this task defines the whole file so later tasks only import it)
  - `cursor.ts`: `class ParseFailure extends Error { readonly line: number }`; `class Cursor` with `constructor(tokens: Token[], sql: string, onWarn: (line: number, message: string) => void)` and: `pos`, `done`, `peek(offset?)`, `next()`, `line()`, `isWord(...words)`, `isSymbol(symbol, offset?)`, `acceptWord(...words)`, `acceptWords(...sequence)`, `expectWord(word)`, `acceptSymbol(symbol)`, `expectSymbol(symbol)`, `identifier(what)`, `dottedName(what): string[]`, `qualifiedName(what): { name: string; schema?: string }` (warns when the schema is not `public`), `skipBalanced()`, `slice(fromPos, toPos): string`, `warn(message)`, `fail(message): never`
  - `parse-type.ts`: `parseColumnType(cursor): { type: RawType; serial: boolean }`

- [ ] **Step 1: Write the failing tests**

`parse-type.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Cursor, ParseFailure } from '../../../../sql/parse/cursor.ts'
import { parseColumnType } from '../../../../sql/parse/parse-type.ts'
import { tokenize } from '../../../../sql/parse/tokenize.ts'

function typeOf(sql: string) {
  const warnings: string[] = []
  const cursor = new Cursor(tokenize(sql).tokens, sql, (_line, message) => {
    warnings.push(message)
  })
  const parsed = parseColumnType(cursor)
  return { ...parsed, warnings, rest: cursor.done ? '' : cursor.peek()?.text }
}

describe('parseColumnType: native types', () => {
  const cases: [string, object][] = [
    ['integer', { kind: 'integer' }],
    ['INT', { kind: 'integer' }],
    ['int4', { kind: 'integer' }],
    ['smallint', { kind: 'smallint' }],
    ['int2', { kind: 'smallint' }],
    ['bigint', { kind: 'bigint' }],
    ['int8', { kind: 'bigint' }],
    ['text', { kind: 'text' }],
    ['boolean', { kind: 'boolean' }],
    ['bool', { kind: 'boolean' }],
    ['uuid', { kind: 'uuid' }],
    ['date', { kind: 'date' }],
    ['interval', { kind: 'interval' }],
    ['json', { kind: 'json' }],
    ['jsonb', { kind: 'json' }],
    ['bytea', { kind: 'bytea' }],
    ['real', { kind: 'real' }],
    ['float4', { kind: 'real' }],
    ['double precision', { kind: 'double' }],
    ['float8', { kind: 'double' }],
    ['float', { kind: 'double' }],
    ['float(10)', { kind: 'real' }],
    ['float(40)', { kind: 'double' }],
  ]
  for (const [sql, expected] of cases) {
    it(`reads ${sql}`, () => assert.deepEqual(typeOf(sql).type, expected))
  }
})

describe('parseColumnType: time types', () => {
  it('maps timestamptz and timestamp with time zone to timestamp, the others to no-tz', () => {
    assert.deepEqual(typeOf('timestamptz').type, { kind: 'timestamp' })
    assert.deepEqual(typeOf('timestamp with time zone').type, { kind: 'timestamp' })
    assert.deepEqual(typeOf('timestamp(3) with time zone').type, { kind: 'timestamp' })
    assert.deepEqual(typeOf('timestamp').type, { kind: 'timestamp_no_tz' })
    assert.deepEqual(typeOf('timestamp without time zone').type, { kind: 'timestamp_no_tz' })
  })

  it('reads time, and warns that a time zone is not kept', () => {
    assert.deepEqual(typeOf('time').type, { kind: 'time' })
    assert.deepEqual(typeOf('time(2) without time zone').type, { kind: 'time' })
    const withZone = typeOf('time with time zone')
    assert.deepEqual(withZone.type, { kind: 'time' })
    assert.equal(withZone.warnings.length, 1)
  })
})

describe('parseColumnType: sized types', () => {
  it('reads varchar, character varying, char and character', () => {
    assert.deepEqual(typeOf('varchar(120)').type, { kind: 'varchar', length: 120 })
    assert.deepEqual(typeOf('character varying(5)').type, { kind: 'varchar', length: 5 })
    assert.deepEqual(typeOf('char(3)').type, { kind: 'char', length: 3 })
    assert.deepEqual(typeOf('character(2)').type, { kind: 'char', length: 2 })
    assert.deepEqual(typeOf('char').type, { kind: 'char', length: 1 })
    assert.deepEqual(typeOf('bpchar').type, { kind: 'char', length: 1 })
  })

  it('reads varchar without a length as text', () => {
    assert.deepEqual(typeOf('varchar').type, { kind: 'text' })
    assert.deepEqual(typeOf('character varying').type, { kind: 'text' })
  })

  it('reads numeric and decimal, with defaults and a warning when unconstrained', () => {
    assert.deepEqual(typeOf('numeric(10,2)').type, { kind: 'numeric', precision: 10, scale: 2 })
    assert.deepEqual(typeOf('decimal(8)').type, { kind: 'numeric', precision: 8, scale: 0 })
    const bare = typeOf('numeric')
    assert.deepEqual(bare.type, { kind: 'numeric', precision: 38, scale: 10 })
    assert.equal(bare.warnings.length, 1)
  })

  it('stops after the type, leaving the rest', () => {
    assert.equal(typeOf('integer NOT NULL').rest, 'NOT')
  })
})

describe('parseColumnType: serial', () => {
  it('reads serial types as integers marked serial', () => {
    assert.deepEqual(typeOf('serial'), { type: { kind: 'integer' }, serial: true, warnings: [], rest: '' })
    assert.deepEqual(typeOf('bigserial').type, { kind: 'bigint' })
    assert.equal(typeOf('bigserial').serial, true)
    assert.deepEqual(typeOf('smallserial').type, { kind: 'smallint' })
    assert.equal(typeOf('integer').serial, false)
  })
})

describe('parseColumnType: arrays and named types', () => {
  it('reads [] and ARRAY suffixes as one array level, however many dimensions', () => {
    const ints = { kind: 'array', of: { kind: 'integer' } }
    assert.deepEqual(typeOf('integer[]').type, ints)
    assert.deepEqual(typeOf('integer[3]').type, ints)
    assert.deepEqual(typeOf('integer[][]').type, ints)
    assert.deepEqual(typeOf('integer ARRAY').type, ints)
    assert.deepEqual(typeOf('varchar(5)[]').type, {
      kind: 'array',
      of: { kind: 'varchar', length: 5 },
    })
  })

  it('reads any other name as a named type, quoted or schema-qualified', () => {
    assert.deepEqual(typeOf('mood').type, { kind: 'named', name: 'mood' })
    assert.deepEqual(typeOf('"Mood"').type, { kind: 'named', name: 'Mood' })
    assert.deepEqual(typeOf('public.mood').type, { kind: 'named', name: 'mood' })
    assert.deepEqual(typeOf('mood[]').type, {
      kind: 'array',
      of: { kind: 'named', name: 'mood' },
    })
    assert.deepEqual(typeOf('money').type, { kind: 'named', name: 'money' })
  })

  it('warns about a schema other than public and fails with no type at all', () => {
    assert.equal(typeOf('app.mood').warnings.length, 1)
    assert.throws(() => typeOf(''), ParseFailure)
    assert.throws(() => typeOf('(1)'), ParseFailure)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/sql/parse/parse-type.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE"`
Expected: FAIL (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Implement `raw.ts`**

```ts
import type { ColumnType } from '../../schema/types.ts'

/** Where a piece of the script came from, for messages. */
export interface Origin {
  line: number
  text: string
}

/** A column type as written: user types are still names, to be resolved later. */
export type RawType =
  | Exclude<ColumnType, { kind: 'array' } | { kind: 'user' }>
  | { kind: 'named'; name: string }
  | { kind: 'array'; of: RawType }

export interface RawReference {
  table: string
  /** Empty means the referenced table's primary key. */
  columns: string[]
  /** ON DELETE / ON UPDATE actions were written (and are not modelled). */
  actions: boolean
}

export interface RawColumn {
  name: string
  type: RawType
  notNull: boolean
  primaryKey: boolean
  unique: boolean
  /** An identity or a serial. */
  generated: boolean
  default?: string
  reference?: RawReference
}

export interface RawForeignKey {
  columns: string[]
  reference: RawReference
}

export interface RawUnique {
  name?: string
  columns: string[]
}

export interface RawTable {
  origin: Origin
  name: string
  columns: RawColumn[]
  primaryKey: string[]
  uniques: RawUnique[]
  foreignKeys: RawForeignKey[]
}

export interface RawIndex {
  origin: Origin
  name?: string
  table: string
  columns: string[]
  unique: boolean
  method: string
}

export interface RawEnum {
  origin: Origin
  kind: 'enum'
  name: string
  values: string[]
}

export interface RawDomain {
  origin: Origin
  kind: 'domain'
  name: string
  base: RawType
  notNull: boolean
  default?: string
}

export interface RawComment {
  origin: Origin
  table: string
  /** Absent for a table comment. */
  column?: string
  text: string
}

export type RawAlter = { origin: Origin; table: string } & (
  | { primaryKey: string[] }
  | { unique: RawUnique }
  | { foreignKey: RawForeignKey }
  /** `ALTER COLUMN c SET DEFAULT expr`, as pg_dump writes a serial's default. */
  | { setDefault: { column: string; expression: string } }
  /** `ALTER COLUMN c ADD GENERATED … AS IDENTITY`. */
  | { identity: string }
)

export interface RawScript {
  tables: RawTable[]
  indexes: RawIndex[]
  types: (RawEnum | RawDomain)[]
  comments: RawComment[]
  alters: RawAlter[]
}

export function emptyScript(): RawScript {
  return { tables: [], indexes: [], types: [], comments: [], alters: [] }
}
```

- [ ] **Step 4: Implement `cursor.ts`**

```ts
import type { Token } from './tokenize.ts'

/** A statement that cannot be read: it becomes an error with its line. */
export class ParseFailure extends Error {
  readonly line: number

  constructor(line: number, message: string) {
    super(message)
    this.line = line
  }
}

/** A position in the tokens of one statement, with the helpers a parser needs. */
export class Cursor {
  pos = 0

  constructor(
    readonly tokens: Token[],
    private readonly sql: string,
    private readonly onWarn: (line: number, message: string) => void
  ) {}

  get done(): boolean {
    return this.pos >= this.tokens.length
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  line(): number {
    return (this.peek() ?? this.tokens[this.tokens.length - 1])?.line ?? 1
  }

  next(): Token {
    const token = this.peek()
    if (!token) return this.fail('The statement ends too soon.')
    this.pos++
    return token
  }

  warn(message: string): void {
    this.onWarn(this.line(), message)
  }

  fail(message: string): never {
    throw new ParseFailure(this.line(), message)
  }

  isWord(...words: string[]): boolean {
    const token = this.peek()
    return token?.kind === 'word' && words.includes(token.value)
  }

  isSymbol(symbol: string, offset = 0): boolean {
    const token = this.peek(offset)
    return token?.kind === 'symbol' && token.value === symbol
  }

  acceptWord(...words: string[]): Token | null {
    if (!this.isWord(...words)) return null
    return this.next()
  }

  /** Accepts the words in order, or none of them. */
  acceptWords(...sequence: string[]): boolean {
    const matches = sequence.every((word, offset) => {
      const token = this.peek(offset)
      return token?.kind === 'word' && token.value === word
    })
    if (matches) this.pos += sequence.length
    return matches
  }

  expectWord(word: string): Token {
    return (
      this.acceptWord(word) ??
      this.fail(`Expected ${word.toUpperCase()}${this.found()}.`)
    )
  }

  acceptSymbol(symbol: string): boolean {
    if (!this.isSymbol(symbol)) return false
    this.pos++
    return true
  }

  expectSymbol(symbol: string): void {
    if (!this.acceptSymbol(symbol)) {
      this.fail(`Expected "${symbol}"${this.found()}.`)
    }
  }

  private found(): string {
    const token = this.peek()
    return token ? `, found "${token.text}"` : ' at the end of the statement'
  }

  /** A name: a bare word (folded to lower case) or a quoted identifier. */
  identifier(what: string): string {
    const token = this.peek()
    if (token?.kind === 'word' || token?.kind === 'ident') {
      this.pos++
      return token.value
    }
    return this.fail(`Expected ${what}${this.found()}.`)
  }

  /** `a`, `a.b` or `a.b.c`, as its parts. */
  dottedName(what: string): string[] {
    const parts = [this.identifier(what)]
    while (this.isSymbol('.')) {
      this.pos++
      parts.push(this.identifier(what))
    }
    return parts
  }

  /** A table or type name, with an optional schema that Forge does not keep. */
  qualifiedName(what: string): { name: string; schema?: string } {
    const parts = this.dottedName(what)
    const name = parts[parts.length - 1] as string
    const schema = parts.length > 1 ? parts[parts.length - 2] : undefined
    if (schema !== undefined && schema !== 'public') {
      this.warn(`Schema "${schema}" is ignored: "${name}" is imported without it.`)
    }
    return schema === undefined ? { name } : { name, schema }
  }

  /** At "(", moves past the matching ")". */
  skipBalanced(): void {
    this.expectSymbol('(')
    let depth = 1
    while (depth > 0) {
      const token = this.next()
      if (token.kind !== 'symbol') continue
      if (token.value === '(') depth++
      else if (token.value === ')') depth--
    }
  }

  /** The source text from token `from` up to (not including) token `to`. */
  slice(from: number, to: number): string {
    const first = this.tokens[from]
    const last = this.tokens[to - 1]
    return first && last ? this.sql.slice(first.start, last.end) : ''
  }
}
```

- [ ] **Step 5: Implement `parse-type.ts`**

```ts
import type { Cursor } from './cursor.ts'
import type { RawType } from './raw.ts'

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
    if (token.kind !== 'number') cursor.fail('Expected a number in the type.')
    numbers.push(Number(token.value))
  } while (cursor.acceptSymbol(','))
  cursor.expectSymbol(')')
  return numbers
}

/** `with time zone` / `without time zone`: whether the zone is kept. */
function readTimeZone(cursor: Cursor): boolean | null {
  if (cursor.acceptWords('with', 'time', 'zone')) return true
  if (cursor.acceptWords('without', 'time', 'zone')) return false
  return null
}

export function parseColumnType(cursor: Cursor): {
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
    base = precision !== undefined && precision <= 24 ? { kind: 'real' } : { kind: 'double' }
  } else if (word === 'varchar' || word === 'character' || word === 'char' || word === 'bpchar') {
    cursor.next()
    const varying = word === 'varchar' || (word === 'character' && cursor.acceptWord('varying') !== null)
    const [length] = readNumbers(cursor)
    if (varying) {
      base = length === undefined ? { kind: 'text' } : { kind: 'varchar', length }
    } else {
      base = { kind: 'char', length: length ?? 1 }
    }
  } else if (word === 'numeric' || word === 'decimal') {
    cursor.next()
    const [precision, scale] = readNumbers(cursor)
    if (precision === undefined) {
      cursor.warn('numeric without a precision is imported as numeric(38,10).')
      base = { kind: 'numeric', precision: 38, scale: 10 }
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
```

- [ ] **Step 6: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write packages 2>&1 | tail -2; pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/core typecheck 2>&1 | grep -c error`
Expected: all pass, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): a cursor over a statement's tokens, and column type parsing

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `CREATE TABLE`

**Files:**
- Create: `packages/core/src/sql/parse/parse-create-table.ts`, `packages/core/src/sql/parse/parse-statement.ts`
- Create (test helper): `packages/core/src/tests/helpers/parse-script.ts`
- Test: `packages/core/src/tests/unit/sql/parse/parse-create-table.test.ts`

**Interfaces:**
- Consumes: Task 1 `tokenize`/`splitStatements`/`Statement`, Task 2 `Cursor`, `ParseFailure`, `parseColumnType`, `raw.ts`.
- Produces:
  - `parse-create-table.ts`: `parseColumnList(cursor): string[]`, `skipElement(cursor): void`, `parseExpression(cursor, what: string): string`, `parseReference(cursor): RawReference`, `parseCreateTable(cursor, origin): RawTable | null` (called after `CREATE [..] TABLE`; null, with a warning, for `AS SELECT` and `PARTITION OF`)
  - `parse-statement.ts`: `type Warn = (line: number, message: string) => void`, `previewOf(text: string): string` (whitespace collapsed, at most 80 characters), `parseStatement(statement, sql, raw, warn): void` (this task: `CREATE TABLE`; every other statement is a warning `<FIRST TWO WORDS> statements are not modelled and were ignored.`; Task 4 replaces the file with the full dispatcher)
  - test helper `parseScript(sql): { raw: RawScript; warnings: string[]; failures: { line: number; message: string }[]; lexErrors }` where each warning is `"<line>: <message>"`
- Behaviour of a column: `name type [constraints…]` with `NOT NULL`, `NULL`, `DEFAULT <expr>`, `PRIMARY KEY`, `UNIQUE`, `REFERENCES t [(c)] [actions]`, `CHECK (…)` (warning), `GENERATED {ALWAYS | BY DEFAULT} AS IDENTITY [(…)]`, `GENERATED ALWAYS AS (expr) STORED` (warning, plain column), `COLLATE x`, optional `CONSTRAINT name` before a constraint. A `serial` type sets `generated` and `notNull`. Table constraints: `[CONSTRAINT n] PRIMARY KEY (…)`, `UNIQUE (…)`, `FOREIGN KEY (…) REFERENCES …`, `CHECK`/`EXCLUDE`/`LIKE` (warnings). An expression for `DEFAULT` runs to the next `,`/`)` at depth 0 or to a constraint keyword (`NOT`, `CONSTRAINT`, `PRIMARY`, `UNIQUE`, `REFERENCES`, `CHECK`, `GENERATED`, `COLLATE`, and `NULL` once the expression has started).

- [ ] **Step 1: Write the test helper and the failing tests**

`packages/core/src/tests/helpers/parse-script.ts`:

```ts
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
```

`parse-create-table.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseScript } from '../../../helpers/parse-script.ts'

const tableOf = (sql: string) => {
  const result = parseScript(sql)
  assert.deepEqual(result.failures, [])
  const table = result.raw.tables[0]
  assert.ok(table, 'no table was read')
  return { table, warnings: result.warnings }
}
const column = (sql: string, name: string) => {
  const found = tableOf(sql).table.columns.find((c) => c.name === name)
  assert.ok(found, `no column ${name}`)
  return found
}

describe('CREATE TABLE: the table and its columns', () => {
  it('reads the name (case-folded unless quoted, schema dropped) and the columns in order', () => {
    const { table } = tableOf('CREATE TABLE public.Users (id integer, "Name" text)')
    assert.equal(table.name, 'users')
    assert.deepEqual(table.columns.map((c) => c.name), ['id', 'Name'])
    assert.equal(tableOf('create table "Users" ()').table.name, 'Users')
  })

  it('accepts IF NOT EXISTS, TEMP, UNLOGGED and an empty column list', () => {
    assert.equal(tableOf('CREATE UNLOGGED TABLE IF NOT EXISTS t ()').table.columns.length, 0)
    assert.equal(tableOf('CREATE TEMP TABLE t (a int)').table.columns.length, 1)
  })

  it('records where the statement came from', () => {
    const { table } = tableOf('\n\nCREATE   TABLE t (\n a int\n);')
    assert.equal(table.origin.line, 3)
    assert.equal(table.origin.text, 'CREATE TABLE t ( a int )')
  })
})

describe('CREATE TABLE: column constraints', () => {
  it('reads NOT NULL, NULL, PRIMARY KEY and UNIQUE', () => {
    const sql = 'CREATE TABLE t (a int NOT NULL, b int NULL, c int PRIMARY KEY, d int UNIQUE)'
    assert.equal(column(sql, 'a').notNull, true)
    assert.equal(column(sql, 'b').notNull, false)
    assert.equal(column(sql, 'c').primaryKey, true)
    assert.equal(column(sql, 'd').unique, true)
  })

  it('keeps the source text of a DEFAULT, whatever it contains', () => {
    const sql = `CREATE TABLE t (
      a int DEFAULT 0 NOT NULL,
      b text DEFAULT 'x, y'::text,
      c timestamptz DEFAULT now(),
      d int DEFAULT (1 + 2) * 3,
      e text DEFAULT NULL,
      f int DEFAULT -1 CONSTRAINT nn NOT NULL
    )`
    assert.equal(column(sql, 'a').default, '0')
    assert.equal(column(sql, 'a').notNull, true)
    assert.equal(column(sql, 'b').default, "'x, y'::text")
    assert.equal(column(sql, 'c').default, 'now()')
    assert.equal(column(sql, 'd').default, '(1 + 2) * 3')
    assert.equal(column(sql, 'e').default, 'NULL')
    assert.equal(column(sql, 'f').default, '-1')
    assert.equal(column(sql, 'f').notNull, true)
  })

  it('marks identity columns and serials as generated', () => {
    const sql = `CREATE TABLE t (
      a integer GENERATED ALWAYS AS IDENTITY,
      b bigint GENERATED BY DEFAULT AS IDENTITY (START WITH 10),
      c serial,
      d int
    )`
    assert.equal(column(sql, 'a').generated, true)
    assert.equal(column(sql, 'b').generated, true)
    assert.equal(column(sql, 'c').generated, true)
    assert.equal(column(sql, 'c').notNull, true)
    assert.equal(column(sql, 'd').generated, false)
  })

  it('warns about a generated expression and keeps a plain column', () => {
    const { table, warnings } = tableOf(
      'CREATE TABLE t (a int, b int GENERATED ALWAYS AS (a * 2) STORED)'
    )
    assert.equal(table.columns[1]?.generated, false)
    assert.equal(warnings.length, 1)
  })

  it('reads an inline REFERENCES with and without a column and with actions', () => {
    const sql = `CREATE TABLE t (
      a int REFERENCES users,
      b int REFERENCES public.users (id) ON DELETE CASCADE ON UPDATE NO ACTION,
      c int REFERENCES users (id) NOT NULL,
      d int REFERENCES users (id) MATCH FULL DEFERRABLE INITIALLY DEFERRED
    )`
    assert.deepEqual(column(sql, 'a').reference, { table: 'users', columns: [], actions: false })
    assert.deepEqual(column(sql, 'b').reference, { table: 'users', columns: ['id'], actions: true })
    assert.equal(column(sql, 'c').notNull, true)
    assert.deepEqual(column(sql, 'c').reference, { table: 'users', columns: ['id'], actions: false })
    assert.equal(column(sql, 'd').reference?.actions, false)
  })

  it('warns about CHECK and skips COLLATE and CONSTRAINT names', () => {
    const { table, warnings } = tableOf(
      'CREATE TABLE t (a int CONSTRAINT pos CHECK (a > 0), b text COLLATE "C" NOT NULL)'
    )
    assert.equal(warnings.length, 1)
    assert.equal(table.columns[1]?.notNull, true)
  })
})

describe('CREATE TABLE: table constraints', () => {
  const sql = `CREATE TABLE t (
    a int, b int, c int,
    CONSTRAINT t_pk PRIMARY KEY (a, b),
    UNIQUE (c),
    CONSTRAINT t_c_key UNIQUE (b, c),
    CONSTRAINT t_fk FOREIGN KEY (c) REFERENCES other (id) ON DELETE SET NULL,
    CHECK (a > 0)
  )`

  it('reads PRIMARY KEY, UNIQUE (named or not) and FOREIGN KEY', () => {
    const { table, warnings } = tableOf(sql)
    assert.deepEqual(table.primaryKey, ['a', 'b'])
    assert.deepEqual(table.uniques, [{ columns: ['c'] }, { name: 't_c_key', columns: ['b', 'c'] }])
    assert.deepEqual(table.foreignKeys, [
      { columns: ['c'], reference: { table: 'other', columns: ['id'], actions: true } },
    ])
    assert.equal(warnings.length, 1)
  })

  it('warns about EXCLUDE and LIKE, keeping the rest of the table', () => {
    const { table, warnings } = tableOf(
      'CREATE TABLE t (a int, EXCLUDE USING gist (a WITH =), LIKE other)'
    )
    assert.equal(table.columns.length, 1)
    assert.equal(warnings.length, 2)
  })
})

describe('CREATE TABLE: what is not a plain table, and what is wrong', () => {
  it('warns and reads nothing for AS SELECT and PARTITION OF', () => {
    for (const sql of ['CREATE TABLE t AS SELECT 1', 'CREATE TABLE t PARTITION OF p FOR VALUES IN (1)']) {
      const result = parseScript(sql)
      assert.equal(result.raw.tables.length, 0, sql)
      assert.equal(result.warnings.length, 1, sql)
    }
  })

  it('warns about trailing partitioning or inheritance and keeps the table', () => {
    const result = parseScript('CREATE TABLE t (a int) PARTITION BY RANGE (a)')
    assert.equal(result.raw.tables.length, 1)
    assert.equal(result.warnings.length, 1)
  })

  it('fails with the line for a broken table, and still reads the next statements', () => {
    const result = parseScript('CREATE TABLE a (x int,\n y);\nCREATE TABLE b (z int);')
    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0]?.line, 2)
    assert.deepEqual(result.raw.tables.map((t) => t.name), ['b'])
  })

  it('fails when the parenthesis is never closed', () => {
    const result = parseScript('CREATE TABLE a (x int')
    assert.equal(result.failures.length, 1)
  })

  it('warns that other statements are not modelled', () => {
    const result = parseScript("INSERT INTO t VALUES (1);\nSET search_path = public;")
    assert.deepEqual(result.warnings, [
      '1: INSERT INTO statements are not modelled and were ignored.',
      '2: SET SEARCH_PATH statements are not modelled and were ignored.',
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/sql/parse/parse-create-table.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE"`
Expected: FAIL (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Implement `parse-create-table.ts`**

```ts
import type { Cursor } from './cursor.ts'
import { parseColumnType } from './parse-type.ts'
import type { Origin, RawColumn, RawReference, RawTable } from './raw.ts'
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
])

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
      if (token.value === '(') depth++
      else if (token.value === ')') {
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
      if (token.value === '(') depth++
      else if (token.value === ')') {
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
    } else if (cursor.isWord('deferrable', 'initially')) {
      const word = cursor.next()
      if (word.value === 'initially') cursor.next()
    } else if (
      cursor.isWord('not') &&
      (cursor.peek(1)?.value === 'deferrable' || cursor.peek(1)?.value === 'valid')
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
  cursor.expectWord('as')
  if (cursor.acceptWord('identity')) {
    column.generated = true
    if (cursor.isSymbol('(')) cursor.skipBalanced()
  } else {
    cursor.skipBalanced()
    cursor.acceptWord('stored')
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
      column.default = parseExpression(cursor, 'DEFAULT')
    } else if (cursor.acceptWords('primary', 'key')) {
      column.primaryKey = true
    } else if (cursor.acceptWord('unique')) {
      column.unique = true
    } else if (cursor.acceptWord('references')) {
      column.reference = parseReference(cursor)
    } else if (cursor.acceptWord('check')) {
      cursor.skipBalanced()
      cursor.warn('A CHECK constraint is not modelled and was ignored.')
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
  if (cursor.acceptWord('constraint')) name = cursor.identifier('a constraint name')
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
    cursor.skipBalanced()
    cursor.warn('A CHECK constraint is not modelled and was ignored.')
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
export function parseCreateTable(cursor: Cursor, origin: Origin): RawTable | null {
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
  cursor.expectSymbol('(')
  const table: RawTable = {
    origin,
    name,
    columns: [],
    primaryKey: [],
    uniques: [],
    foreignKeys: [],
  }
  if (!cursor.acceptSymbol(')')) {
    do {
      if (
        cursor.isWord('constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like')
      ) {
        parseTableConstraint(cursor, table)
      } else {
        parseColumn(cursor, table)
      }
    } while (cursor.acceptSymbol(','))
    cursor.expectSymbol(')')
  }
  if (cursor.isWord('inherits', 'partition')) {
    cursor.warn(
      `Inheritance and partitioning of "${name}" are not modelled; it is imported as a plain table.`
    )
  }
  return table
}
```

- [ ] **Step 4: Implement `parse-statement.ts` (this task's version)**

```ts
import { Cursor } from './cursor.ts'
import { parseCreateTable } from './parse-create-table.ts'
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
  }
  ignored(statement, warn)
}
```

- [ ] **Step 5: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write packages 2>&1 | tail -2; pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/core typecheck 2>&1 | grep -c error`
Expected: all pass, 0 type errors. If the origin test fails only on whitespace, fix `previewOf`, not the test.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): parse CREATE TABLE statements

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `ALTER TABLE`, indexes, types, domains and comments

**Files:**
- Create: `packages/core/src/sql/parse/parse-other.ts`
- Modify (replace the whole file): `packages/core/src/sql/parse/parse-statement.ts`
- Test: `packages/core/src/tests/unit/sql/parse/parse-other.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`parseColumnList`, `skipElement`, `parseExpression`, `parseReference`, `parseColumnType`, `Cursor`, `raw.ts`, helper `parseScript`).
- Produces in `parse-other.ts`: `parseAlterTable(cursor, origin, raw): void` (after `ALTER TABLE`), `parseCreateIndex(cursor, origin, unique): RawIndex | null` (after `CREATE [UNIQUE] INDEX`), `parseCreateType(cursor, origin): RawEnum | null` (after `CREATE TYPE`), `parseCreateDomain(cursor, origin): RawDomain` (after `CREATE DOMAIN`), `parseComment(cursor, origin): RawComment | null` (after `COMMENT ON`).
- Behaviour: `ALTER TABLE [IF EXISTS] [ONLY] t action[, action…]`; `ADD [CONSTRAINT n] PRIMARY KEY (…) | UNIQUE (…) | FOREIGN KEY (…) REFERENCES …` become `raw.alters`; `ALTER COLUMN c SET DEFAULT expr` and `ALTER COLUMN c ADD GENERATED … AS IDENTITY` become `raw.alters` too (this is how `pg_dump` writes a serial); `ADD CHECK` and every other action are warnings. `CREATE INDEX [CONCURRENTLY] [IF NOT EXISTS] [name] ON [ONLY] t [USING m] (cols)`: kept only when every element is a plain column (no `ASC`/`DESC`/`NULLS`/opclass/expression), there is no `INCLUDE` or `WHERE`, and the method is `btree`, `hash`, `gin` or `gist`; otherwise a warning that names the index. `CREATE TYPE n AS ENUM ('a', …)`; composite, range and shell types are warnings. `CREATE DOMAIN n [AS] type [DEFAULT expr] [NOT NULL | NULL] [COLLATE c] [[CONSTRAINT n] CHECK (…)]` (`CHECK` warns). `COMMENT ON TABLE t IS '…'`, `COMMENT ON COLUMN [s.]t.c IS '…'` (`IS NULL` is silently nothing); any other `COMMENT ON` object is a warning.
- Dispatcher: `CREATE [UNIQUE] INDEX`, `CREATE TYPE`, `CREATE DOMAIN`, `ALTER TABLE`, `COMMENT ON` are routed here; everything else stays "not modelled".

- [ ] **Step 1: Write the failing tests**

`parse-other.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseScript } from '../../../helpers/parse-script.ts'

describe('ALTER TABLE', () => {
  it('reads ADD CONSTRAINT for a primary key, a unique and a foreign key', () => {
    const sql = `
      ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
      ALTER TABLE public.orders ADD UNIQUE (code);
      ALTER TABLE ONLY orders
        ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;`
    const { raw, failures, warnings } = parseScript(sql)
    assert.deepEqual(failures, [])
    assert.deepEqual(warnings, [])
    assert.deepEqual(
      raw.alters.map(({ origin: _origin, ...rest }) => rest),
      [
        { table: 'orders', primaryKey: ['id'] },
        { table: 'orders', unique: { columns: ['code'] } },
        {
          table: 'orders',
          foreignKey: {
            columns: ['user_id'],
            reference: { table: 'users', columns: ['id'], actions: true },
          },
        },
      ]
    )
  })

  it('reads several actions in one statement and warns about the ones it does not model', () => {
    const { raw, warnings } = parseScript(
      'ALTER TABLE t ADD PRIMARY KEY (a), OWNER TO me, ADD CHECK (a > 0), ENABLE ROW LEVEL SECURITY'
    )
    assert.equal(raw.alters.length, 1)
    assert.equal(warnings.length, 3)
  })

  it('reads ALTER COLUMN SET DEFAULT and ADD GENERATED, as pg_dump writes a serial', () => {
    const { raw, warnings } = parseScript(`
      ALTER TABLE ONLY public.t ALTER COLUMN id SET DEFAULT nextval('public.t_id_seq'::regclass);
      ALTER TABLE public.t ALTER COLUMN n ADD GENERATED BY DEFAULT AS IDENTITY (SEQUENCE NAME public.t_n_seq START WITH 1);
      ALTER TABLE t ALTER COLUMN x SET NOT NULL;`)
    assert.deepEqual(
      raw.alters.map(({ origin: _origin, ...rest }) => rest),
      [
        { table: 't', setDefault: { column: 'id', expression: "nextval('public.t_id_seq'::regclass)" } },
        { table: 't', identity: 'n' },
      ]
    )
    assert.equal(warnings.length, 1)
  })

  it('warns about ADD COLUMN, which is not modelled', () => {
    const { raw, warnings } = parseScript('ALTER TABLE t ADD COLUMN x int')
    assert.equal(raw.alters.length, 0)
    assert.equal(warnings.length, 1)
  })

  it('warns about ALTER statements for other objects', () => {
    const { warnings } = parseScript('ALTER SEQUENCE s OWNED BY t.id; ALTER TYPE x OWNER TO me')
    assert.equal(warnings.length, 2)
  })
})

describe('CREATE INDEX', () => {
  const indexOf = (sql: string) => {
    const result = parseScript(sql)
    assert.deepEqual(result.failures, [])
    return { index: result.raw.indexes[0], warnings: result.warnings }
  }

  it('reads a plain, a unique, a named-method and an unnamed index', () => {
    const { index } = indexOf('CREATE INDEX idx_a ON public.t USING btree (a, "B")')
    assert.deepEqual(
      { ...index, origin: undefined },
      { origin: undefined, name: 'idx_a', table: 't', columns: ['a', 'B'], unique: false, method: 'btree' }
    )
    assert.equal(indexOf('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS u ON t (a)').index?.unique, true)
    assert.equal(indexOf('CREATE INDEX ON t USING gin (a)').index?.name, undefined)
    assert.equal(indexOf('CREATE INDEX ON t USING gin (a)').index?.method, 'gin')
    assert.equal(indexOf('CREATE INDEX i ON ONLY t (a) WITH (fillfactor = 70)').index?.columns[0], 'a')
  })

  it('warns and drops an index with an expression, ordering, INCLUDE, WHERE or another method', () => {
    for (const sql of [
      'CREATE INDEX i ON t (lower(a))',
      'CREATE INDEX i ON t (a DESC)',
      'CREATE INDEX i ON t (a NULLS FIRST)',
      'CREATE INDEX i ON t (a text_pattern_ops)',
      'CREATE INDEX i ON t (a) INCLUDE (b)',
      'CREATE INDEX i ON t (a) WHERE a > 0',
      'CREATE INDEX i ON t USING brin (a)',
    ]) {
      const { index, warnings } = indexOf(sql)
      assert.equal(index, undefined, sql)
      assert.equal(warnings.length, 1, sql)
      assert.ok(warnings[0]?.includes('"i"'), sql)
    }
  })
})

describe('CREATE TYPE', () => {
  it('reads an enum with its values, in order', () => {
    const { raw, failures } = parseScript("CREATE TYPE public.mood AS ENUM ('sad', 'it''s ok', 'happy')")
    assert.deepEqual(failures, [])
    assert.equal(raw.types[0]?.kind, 'enum')
    assert.equal(raw.types[0]?.name, 'mood')
    assert.deepEqual(raw.types[0]?.kind === 'enum' && raw.types[0].values, ['sad', "it's ok", 'happy'])
  })

  it('reads an enum with no values', () => {
    const { raw } = parseScript('CREATE TYPE e AS ENUM ()')
    assert.deepEqual(raw.types[0]?.kind === 'enum' && raw.types[0].values, [])
  })

  it('warns about composite, range and shell types', () => {
    for (const sql of ['CREATE TYPE c AS (a int, b text)', 'CREATE TYPE r AS RANGE (subtype = int)', 'CREATE TYPE s']) {
      const { raw, warnings } = parseScript(sql)
      assert.equal(raw.types.length, 0, sql)
      assert.equal(warnings.length, 1, sql)
    }
  })

  it('fails for an enum value that is not a string', () => {
    assert.equal(parseScript('CREATE TYPE e AS ENUM (1)').failures.length, 1)
  })
})

describe('CREATE DOMAIN', () => {
  it('reads the base type, NOT NULL and a default, and warns about CHECK', () => {
    const { raw, warnings, failures } = parseScript(
      "CREATE DOMAIN public.email AS varchar(255) DEFAULT 'x@y' NOT NULL CONSTRAINT ok CHECK (VALUE LIKE '%@%')"
    )
    assert.deepEqual(failures, [])
    const domain = raw.types[0]
    assert.equal(domain?.kind, 'domain')
    if (domain?.kind === 'domain') {
      assert.equal(domain.name, 'email')
      assert.deepEqual(domain.base, { kind: 'varchar', length: 255 })
      assert.equal(domain.notNull, true)
      assert.equal(domain.default, "'x@y'")
    }
    assert.equal(warnings.length, 1)
  })

  it('accepts a domain without AS and based on another type name', () => {
    const { raw } = parseScript('CREATE DOMAIN d text; CREATE DOMAIN d2 AS d')
    assert.equal(raw.types.length, 2)
    const second = raw.types[1]
    assert.deepEqual(second?.kind === 'domain' && second.base, { kind: 'named', name: 'd' })
  })
})

describe('COMMENT ON', () => {
  it('reads table and column comments, with or without a schema', () => {
    const { raw, failures, warnings } = parseScript(`
      COMMENT ON TABLE public.users IS 'People';
      COMMENT ON COLUMN public.users.email IS 'it''s the login';
      COMMENT ON COLUMN users.name IS 'Full name';`)
    assert.deepEqual(failures, [])
    assert.deepEqual(warnings, [])
    assert.deepEqual(
      raw.comments.map(({ origin: _origin, ...rest }) => rest),
      [
        { table: 'users', text: 'People' },
        { table: 'users', column: 'email', text: "it's the login" },
        { table: 'users', column: 'name', text: 'Full name' },
      ]
    )
  })

  it('treats IS NULL as nothing, and warns about other objects', () => {
    const { raw, warnings } = parseScript(
      "COMMENT ON TABLE t IS NULL; COMMENT ON FUNCTION f() IS 'x'; COMMENT ON INDEX i IS 'x'"
    )
    assert.equal(raw.comments.length, 0)
    assert.equal(warnings.length, 2)
  })
})

describe('the dispatcher', () => {
  it('reads every kind of statement of a small script', () => {
    const { raw, warnings, failures } = parseScript(`
      CREATE TYPE s AS ENUM ('a');
      CREATE TABLE t (id int);
      CREATE INDEX i ON t (id);
      COMMENT ON TABLE t IS 'x';
      CREATE EXTENSION pgcrypto;
      CREATE VIEW v AS SELECT 1;`)
    assert.deepEqual(failures, [])
    assert.deepEqual(
      [raw.types.length, raw.tables.length, raw.indexes.length, raw.comments.length],
      [1, 1, 1, 1]
    )
    assert.deepEqual(warnings, [
      '6: CREATE EXTENSION statements are not modelled and were ignored.',
      '7: CREATE VIEW statements are not modelled and were ignored.',
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/sql/parse/parse-other.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL (several tests: the dispatcher still ignores these statements).

- [ ] **Step 3: Implement `parse-other.ts`**

```ts
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

const INDEX_METHODS = ['btree', 'hash', 'gin', 'gist']

/** Moves to the `,` that separates ALTER TABLE actions (depth 0), or the end. */
function skipAction(cursor: Cursor): void {
  let depth = 0
  while (!cursor.done) {
    const token = cursor.peek() as Token
    if (token.kind === 'symbol') {
      if (token.value === '(') depth++
      else if (token.value === ')') depth--
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
          unique: constraintName === undefined ? { columns } : { name: constraintName, columns },
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
        cursor.warn(`ALTER TABLE "${table}" ADD … is not modelled and was ignored.`)
        skipAction(cursor)
      }
    } else if (cursor.acceptWord('alter')) {
      cursor.acceptWord('column')
      const column = cursor.identifier('a column name')
      if (cursor.acceptWords('set', 'default')) {
        raw.alters.push({
          origin,
          table,
          setDefault: { column, expression: parseExpression(cursor, 'DEFAULT') },
        })
      } else if (cursor.acceptWords('add', 'generated')) {
        raw.alters.push({ origin, table, identity: column })
        skipAction(cursor)
      } else {
        cursor.warn(`ALTER TABLE "${table}" ALTER COLUMN … is not modelled and was ignored.`)
        skipAction(cursor)
      }
    } else {
      const word = cursor.peek()?.text.toUpperCase() ?? ''
      cursor.warn(`ALTER TABLE "${table}" ${word} … is not modelled and was ignored.`)
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
  const name = cursor.isWord('on') ? undefined : cursor.identifier('an index name')
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
  else if (!INDEX_METHODS.includes(method)) reason = `the "${method}" method`

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
  cursor.warn(`Type "${name}" is not an enum and is not modelled; it was ignored.`)
  return null
}

/** After `CREATE DOMAIN`. */
export function parseCreateDomain(cursor: Cursor, origin: Origin): RawDomain {
  const { name } = cursor.qualifiedName('a domain name')
  cursor.acceptWord('as')
  const { type } = parseColumnType(cursor)
  const domain: RawDomain = { origin, kind: 'domain', name, base: type, notNull: false }
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
      cursor.warn(`The CHECK of domain "${name}" is not modelled and was ignored.`)
    } else {
      cursor.fail(`Unexpected "${cursor.peek()?.text ?? ''}" in the definition of domain "${name}".`)
    }
  }
  return domain
}

/** After `COMMENT ON`. Null when there is nothing to keep. */
export function parseComment(cursor: Cursor, origin: Origin): RawComment | null {
  const kind = cursor.peek()?.value
  if (kind !== 'table' && kind !== 'column') {
    cursor.warn(`COMMENT ON ${(cursor.peek()?.text ?? '').toUpperCase()} is not modelled and was ignored.`)
    return null
  }
  cursor.next()
  const parts = cursor.dottedName('a name')
  cursor.expectWord('is')
  const token = cursor.next()
  if (token.kind === 'word' && token.value === 'null') return null
  if (token.kind !== 'string') cursor.fail('Expected a quoted comment or NULL.')
  if (kind === 'table') {
    return { origin, table: parts[parts.length - 1] as string, text: token.value }
  }
  if (parts.length < 2) cursor.fail('A column comment needs a table and a column.')
  return {
    origin,
    table: parts[parts.length - 2] as string,
    column: parts[parts.length - 1] as string,
    text: token.value,
  }
}
```

- [ ] **Step 4: Replace `parse-statement.ts` with the full dispatcher**

Keep `Warn`, `previewOf` and `ignored` exactly as in Task 3, import the new parsers, and replace `parseStatement`:

```ts
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
```

with the imports `import { parseAlterTable, parseComment, parseCreateDomain, parseCreateIndex, parseCreateType } from './parse-other.ts'`. Note: `CREATE UNIQUE` that is not followed by `INDEX` falls to `ignored`; `ALTER SEQUENCE`/`ALTER TYPE` fall to `ignored` too (the test in this task expects one warning each: the generic "not modelled" message qualifies).

- [ ] **Step 5: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write packages 2>&1 | tail -2; pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/core typecheck 2>&1 | grep -c error`
Expected: all pass, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): parse ALTER TABLE, indexes, types, domains and comments

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Building the schema, and `importSql`

**Files:**
- Create: `packages/core/src/sql/parse/build-schema.ts`, `packages/core/src/sql/parse/import-sql.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/tests/unit/sql/parse/import-sql.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`tokenize`, `splitStatements`, `parseStatement`, `RawScript`, `ParseFailure`, `Origin`), the model operations (`createSchema`, `addTable`, `addColumn`, `setPrimaryKey`, `addIndex`, `addType`, `addRelationship`, `setTableComment`, `updateColumn`), `checkRelationship`, `validate`, `GENERATED_COLUMN_KINDS`.
- Produces:
  - `build-schema.ts`: `buildSchema(raw: RawScript, newId: () => string, warn: (origin: Origin, message: string) => void): Schema`
  - `import-sql.ts`: `interface ImportMessage { line: number; statement: string; message: string }`, `interface ImportResult { schema: Schema; warnings: ImportMessage[]; errors: ImportMessage[] }`, `importSql(sql: string, newId: () => string): ImportResult`
  - exported from `packages/core/src/index.ts`: `importSql`, `type ImportResult`, `type ImportMessage`
- Rules the builder applies (each has a test below):
  - ids come from `newId`; unquoted names are already lower-cased by the tokenizer; names are matched exactly
  - types first (enums and domains, so a column can use a type defined anywhere in the script); `named` types resolve to `{ kind: 'user', typeId }`, an unknown name is `text` with a warning
  - a column is `NOT NULL` when declared so, when it is in the primary key, or when it is an integer/bigint identity; primary key = `ALTER … PRIMARY KEY`, else the table constraint, else the columns marked inline
  - `generated`: identity/serial, `nextval(...)` on integer/bigint (warning), `now()`/`CURRENT_TIMESTAMP`/`transaction_timestamp()`/… on `timestamp`, `gen_random_uuid()`/`uuid_generate_v4()` on `uuid`; a generated smallint is a plain column with a warning; any other default is raw
  - unique constraints/columns → unique indexes (named after the constraint, else `uq_<table>_<columns>`); `CREATE INDEX` → index (unnamed: `idx_<table>_<columns>`); a name already used gets `_2`, `_3`… (with a warning when the name was written in the script); a second unique index on the same columns is skipped; unknown table or column → warning
  - foreign keys (inline, table-level, `ALTER … ADD … FOREIGN KEY`): kept only if single-column, both tables and columns exist (no column on the target = its sole primary key) and `checkRelationship` accepts them; otherwise a warning with the reason; `ON DELETE/UPDATE` actions add a warning
  - comments are applied to existing tables and columns; blank text is skipped
  - the result is passed to `validate`; each issue becomes an entry in `errors` (`line: 0`, `statement: ''`)

- [ ] **Step 1: Write the failing tests**

`import-sql.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { importSql } from '../../../../sql/parse/import-sql.ts'

function run(sql: string) {
  let counter = 0
  return importSql(sql, () => `id-${++counter}`)
}
const messages = (list: { message: string }[]) => list.map((item) => item.message)
const tableNamed = (sql: string, name: string) => {
  const found = run(sql).schema.tables.find((table) => table.name === name)
  assert.ok(found, `no table ${name}`)
  return found
}

describe('importSql: nothing to import', () => {
  it('gives an empty schema and no messages for empty input and for only comments', () => {
    for (const sql of ['', '   \n', '-- just a comment\n/* and another */']) {
      const result = run(sql)
      assert.deepEqual(result.schema, { version: 1, tables: [], relationships: [] })
      assert.deepEqual(result.warnings, [])
      assert.deepEqual(result.errors, [])
    }
  })
})

describe('importSql: tables and columns', () => {
  const sql = `CREATE TABLE public.Users (
    id integer NOT NULL,
    "Name" varchar(120) NOT NULL,
    bio text,
    PRIMARY KEY (id)
  );`

  it('creates the table, its columns in order, and the primary key', () => {
    const table = tableNamed(sql, 'users')
    assert.deepEqual(table.columns.map((c) => c.name), ['id', 'Name', 'bio'])
    assert.deepEqual(table.primaryKey, [table.columns[0]?.id])
    assert.deepEqual(table.columns.map((c) => c.nullable), [false, false, true])
    assert.deepEqual(table.columns[1]?.type, { kind: 'varchar', length: 120 })
  })

  it('takes the primary key from a column, a table constraint or an ALTER', () => {
    const inline = tableNamed('CREATE TABLE t (a int PRIMARY KEY, b int)', 't')
    assert.deepEqual(inline.primaryKey, [inline.columns[0]?.id])
    const composite = tableNamed('CREATE TABLE t (a int, b int, PRIMARY KEY (a, b))', 't')
    assert.equal(composite.primaryKey.length, 2)
    const altered = tableNamed(
      'CREATE TABLE t (a int, b int); ALTER TABLE ONLY public.t ADD CONSTRAINT t_pkey PRIMARY KEY (b);',
      't'
    )
    assert.deepEqual(altered.primaryKey, [altered.columns[1]?.id])
  })

  it('warns about a primary key column that does not exist', () => {
    const result = run('CREATE TABLE t (a int, PRIMARY KEY (zz))')
    assert.equal(result.warnings.length, 1)
  })

  it('keeps the first of two tables with the same name, and of two columns', () => {
    const tables = run('CREATE TABLE t (a int); CREATE TABLE t (b int);')
    assert.equal(tables.schema.tables.length, 1)
    assert.equal(tables.schema.tables[0]?.columns[0]?.name, 'a')
    assert.equal(tables.warnings.length, 1)
    const columns = run('CREATE TABLE t (a int, a text)')
    assert.equal(columns.schema.tables[0]?.columns.length, 1)
    assert.equal(columns.warnings.length, 1)
  })

  it('treats Users and "Users" as different tables', () => {
    assert.equal(run('CREATE TABLE Users (a int); CREATE TABLE "Users" (a int);').schema.tables.length, 2)
  })
})

describe('importSql: generated columns and defaults', () => {
  const column = (sql: string, name: string) => {
    const found = tableNamed(sql, 't').columns.find((c) => c.name === name)
    assert.ok(found)
    return found
  }

  it('turns identity, serial, now() and a uuid function into generated columns', () => {
    const sql = `CREATE TABLE t (
      a integer GENERATED BY DEFAULT AS IDENTITY,
      b bigserial,
      c timestamptz DEFAULT now() NOT NULL,
      d timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
      e uuid DEFAULT gen_random_uuid(),
      f uuid DEFAULT public.uuid_generate_v4(),
      g integer DEFAULT nextval('t_g_seq'::regclass)
    )`
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      assert.equal(column(sql, name).generated, true, name)
      assert.equal(column(sql, name).default, undefined, name)
    }
    assert.equal(column(sql, 'a').nullable, false)
    assert.equal(column(sql, 'b').nullable, false)
    assert.equal(column(sql, 'e').nullable, true)
    assert.equal(run(sql).warnings.length, 1)
  })

  it('keeps any other default raw, and a now() default on a timestamp without time zone', () => {
    const sql = `CREATE TABLE t (
      a integer DEFAULT 0,
      b text DEFAULT 'x',
      c timestamp DEFAULT now(),
      d integer GENERATED ALWAYS AS IDENTITY
    )`
    assert.equal(column(sql, 'a').default, '0')
    assert.equal(column(sql, 'b').default, "'x'")
    assert.equal(column(sql, 'c').default, 'now()')
    assert.equal(column(sql, 'c').generated, undefined)
  })

  it('imports a smallint serial as a plain smallint NOT NULL, with a warning', () => {
    const result = run('CREATE TABLE t (a smallserial)')
    const found = result.schema.tables[0]?.columns[0]
    assert.deepEqual(found?.type, { kind: 'smallint' })
    assert.equal(found?.generated, undefined)
    assert.equal(found?.nullable, false)
    assert.equal(result.warnings.length, 1)
  })
})

describe('importSql: types', () => {
  const sql = `
    CREATE TABLE orders (id int, status public.order_status NOT NULL DEFAULT 'pending', tags order_status[], mood sad_mood);
    CREATE TYPE order_status AS ENUM ('pending', 'paid');
    CREATE DOMAIN email AS text NOT NULL;
    CREATE TABLE people (address email);`

  it('resolves a type defined after the table that uses it, and arrays of it', () => {
    const result = run(sql)
    const typeId = result.schema.types?.find((t) => t.name === 'order_status')?.id
    assert.ok(typeId)
    const orders = result.schema.tables[0]
    assert.deepEqual(orders?.columns[1]?.type, { kind: 'user', typeId })
    assert.equal(orders?.columns[1]?.default, "'pending'")
    assert.deepEqual(orders?.columns[2]?.type, { kind: 'array', of: { kind: 'user', typeId } })
  })

  it('creates enums and domains, and resolves a domain used as a column type', () => {
    const result = run(sql)
    assert.deepEqual(result.schema.types?.map((t) => [t.kind, t.name]), [
      ['enum', 'order_status'],
      ['domain', 'email'],
    ])
    const domainId = result.schema.types?.[1]?.id
    assert.deepEqual(result.schema.tables[1]?.columns[0]?.type, { kind: 'user', typeId: domainId })
  })

  it('imports an unknown type as text, with a warning', () => {
    const result = run(sql)
    assert.deepEqual(result.schema.tables[0]?.columns[3]?.type, { kind: 'text' })
    assert.ok(messages(result.warnings).some((m) => m.includes('sad_mood')))
  })

  it('keeps the first of two types with the same name', () => {
    const result = run("CREATE TYPE e AS ENUM ('a'); CREATE TYPE e AS ENUM ('b');")
    assert.equal(result.schema.types?.length, 1)
    assert.equal(result.warnings.length, 1)
  })
})

describe('importSql: foreign keys', () => {
  const parent = 'CREATE TABLE users (id int PRIMARY KEY, code text UNIQUE);'
  const relationships = (sql: string) => run(sql).schema.relationships

  it('reads inline, table-level and ALTER foreign keys, to a table defined later too', () => {
    const sql = `
      CREATE TABLE a (id int PRIMARY KEY, user_id int REFERENCES users (id));
      CREATE TABLE b (id int PRIMARY KEY, user_id int, FOREIGN KEY (user_id) REFERENCES users (id));
      CREATE TABLE c (id int PRIMARY KEY, user_id int);
      ALTER TABLE ONLY c ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES public.users (id);
      ${parent}`
    const result = run(sql)
    assert.equal(result.schema.relationships.length, 3)
    assert.deepEqual(result.warnings, [])
    const [first] = result.schema.relationships
    const users = result.schema.tables.find((t) => t.name === 'users')
    assert.equal(first?.to.tableId, users?.id)
    assert.equal(first?.to.columnId, users?.columns[0]?.id)
  })

  it('uses the sole primary key when the column is not written', () => {
    assert.equal(relationships(`${parent} CREATE TABLE a (id int, user_id int REFERENCES users);`).length, 1)
  })

  it('drops, with a warning, a key to an unknown table or column, a composite key, and a non-primary-key target', () => {
    const cases: [string, string][] = [
      [`${parent} CREATE TABLE a (user_id int REFERENCES nope (id))`, 'nope'],
      [`${parent} CREATE TABLE a (user_id int REFERENCES users (zz))`, 'zz'],
      [`${parent} CREATE TABLE a (x int, y int, FOREIGN KEY (x, y) REFERENCES users (id, code))`, 'composite'],
      [`${parent} CREATE TABLE a (user_id text REFERENCES users (code))`, 'primary key'],
      [`${parent} CREATE TABLE a (user_id text REFERENCES users (id))`, 'types differ'],
      [`${parent} ALTER TABLE ghost ADD FOREIGN KEY (x) REFERENCES users (id)`, 'ghost'],
    ]
    for (const [sql, fragment] of cases) {
      const result = run(sql)
      assert.equal(result.schema.relationships.length, 0, sql)
      assert.ok(
        messages(result.warnings).some((m) => m.toLowerCase().includes(fragment)),
        `${sql} → ${JSON.stringify(messages(result.warnings))}`
      )
      assert.deepEqual(result.errors, [], sql)
    }
  })

  it('keeps the key and warns that ON DELETE / ON UPDATE actions are ignored', () => {
    const result = run(`${parent} CREATE TABLE a (user_id int REFERENCES users (id) ON DELETE CASCADE)`)
    assert.equal(result.schema.relationships.length, 1)
    assert.equal(result.warnings.length, 1)
  })

  it('keeps only one key from a column that references twice', () => {
    const sql = `${parent} CREATE TABLE a (user_id int REFERENCES users (id)); ALTER TABLE a ADD FOREIGN KEY (user_id) REFERENCES users (id);`
    assert.equal(run(sql).schema.relationships.length, 1)
  })
})

describe('importSql: indexes', () => {
  const indexes = (sql: string) => run(sql).schema.tables[0]?.indexes ?? []

  it('turns UNIQUE into unique indexes named after the constraint, or uq_<table>_<columns>', () => {
    const list = indexes(`CREATE TABLE t (a int UNIQUE, b int, c int, UNIQUE (b, c), CONSTRAINT t_c_key UNIQUE (c))`)
    assert.deepEqual(
      list.map((i) => [i.name, i.unique, i.columns.length]),
      [
        ['uq_t_a', true, 1],
        ['uq_t_b_c', true, 2],
        ['t_c_key', true, 1],
      ]
    )
  })

  it('reads CREATE INDEX, naming an unnamed one idx_<table>_<columns>', () => {
    const list = indexes('CREATE TABLE t (a int, b int); CREATE INDEX ON t USING gin (a, b); CREATE INDEX i ON t (b);')
    assert.deepEqual(
      list.map((i) => [i.name, i.method]),
      [
        ['idx_t_a_b', 'gin'],
        ['i', 'btree'],
      ]
    )
  })

  it('renames a name that is already taken, and skips a repeated unique index', () => {
    const renamed = run('CREATE TABLE t (a int, b int); CREATE INDEX i ON t (a); CREATE INDEX i ON t (b);')
    assert.deepEqual(renamed.schema.tables[0]?.indexes?.map((i) => i.name), ['i', 'i_2'])
    assert.equal(renamed.warnings.length, 1)
    assert.equal(indexes('CREATE TABLE t (a int UNIQUE); CREATE UNIQUE INDEX u ON t (a);').length, 1)
  })

  it('warns about an index on an unknown table or column', () => {
    const result = run('CREATE TABLE t (a int); CREATE INDEX i ON nope (a); CREATE INDEX j ON t (zz);')
    assert.equal(result.warnings.length, 2)
    assert.equal(result.schema.tables[0]?.indexes, undefined)
  })
})

describe('importSql: comments and sequences', () => {
  it('applies table and column comments, and warns about unknown targets', () => {
    const result = run(`CREATE TABLE t (a int);
      COMMENT ON TABLE t IS 'People';
      COMMENT ON COLUMN public.t.a IS 'The key';
      COMMENT ON TABLE ghost IS 'x';
      COMMENT ON COLUMN t.zz IS 'x';`)
    assert.equal(result.schema.tables[0]?.comment, 'People')
    assert.equal(result.schema.tables[0]?.columns[0]?.comment, 'The key')
    assert.equal(result.warnings.length, 2)
  })

  it('reads a default set by ALTER COLUMN, and an identity added by ALTER COLUMN, as pg_dump writes them', () => {
    const result = run(`CREATE TABLE t (id integer NOT NULL, n integer, c integer);
      ALTER TABLE ONLY public.t ALTER COLUMN id SET DEFAULT nextval('public.t_id_seq'::regclass);
      ALTER TABLE ONLY public.t ALTER COLUMN n SET DEFAULT 5;
      ALTER TABLE public.t ALTER COLUMN c ADD GENERATED BY DEFAULT AS IDENTITY (SEQUENCE NAME public.t_c_seq START WITH 1);`)
    const [id, n, c] = result.schema.tables[0]?.columns ?? []
    assert.equal(id?.generated, true)
    assert.equal(n?.default, '5')
    assert.equal(c?.generated, true)
  })
})

describe('importSql: messages', () => {
  it('reports a warning with its line and the statement', () => {
    const result = run("CREATE TABLE t (a int);\n\nINSERT INTO t VALUES (1);")
    assert.deepEqual(result.warnings, [
      {
        line: 3,
        statement: 'INSERT INTO t VALUES (1)',
        message: 'INSERT INTO statements are not modelled and were ignored.',
      },
    ])
  })

  it('reports a syntax error with its line, and still imports the other statements', () => {
    const result = run('CREATE TABLE a (x int);\nCREATE TABLE b (y);\nCREATE TABLE c (z int);')
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0]?.line, 2)
    assert.deepEqual(result.schema.tables.map((t) => t.name), ['a', 'c'])
  })

  it('reports a truncated script as an error and keeps what came before', () => {
    const result = run("CREATE TABLE a (x int);\nCREATE TABLE b (y text DEFAULT 'oops")
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0]?.line, 2)
    assert.deepEqual(result.schema.tables.map((t) => t.name), ['a'])
  })

  it('turns the issues of the schema into errors', () => {
    const result = run("CREATE TYPE e AS ENUM ();")
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0]?.line, 0)
  })

  it('does not repeat the same warning for the same statement text on the same line', () => {
    assert.equal(run('CREATE TABLE t (a int); SET x = 1; SET x = 1;').warnings.length, 1)
    assert.equal(run('SET x = 1;\nSET x = 1;').warnings.length, 2)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/sql/parse/import-sql.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE"`
Expected: FAIL (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Implement `build-schema.ts`**

```ts
import {
  addColumn,
  addIndex,
  addRelationship,
  addTable,
  addType,
  createSchema,
  setPrimaryKey,
  setTableComment,
  updateColumn,
} from '../../schema/operations.ts'
import type { ColumnType, Schema } from '../../schema/types.ts'
import { GENERATED_COLUMN_KINDS } from '../../schema/types.ts'
import { checkRelationship } from '../../schema/validate.ts'
import type {
  Origin,
  RawColumn,
  RawReference,
  RawScript,
  RawTable,
  RawType,
} from './raw.ts'

export type BuildWarn = (origin: Origin, message: string) => void

const NOW_DEFAULT =
  /^(now\(\)|current_timestamp(\(\d*\))?|transaction_timestamp\(\)|statement_timestamp\(\)|clock_timestamp\(\))(::[a-z ]+)?$/
const UUID_DEFAULT = /^(public\.)?(gen_random_uuid|uuid_generate_v4)\(\)$/
const SEQUENCE_DEFAULT = /^nextval\(/

interface BuiltTable {
  id: string
  raw: RawTable
  columnIds: Map<string, string>
}

interface ForeignKey {
  origin: Origin
  table: string
  columns: string[]
  reference: RawReference
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, at) => id === b[at])

export function buildSchema(
  raw: RawScript,
  newId: () => string,
  warn: BuildWarn
): Schema {
  let schema = createSchema()

  // ---- types: assigned first, so a column can use a type defined anywhere
  const typeIds = new Map<string, string>()
  for (const type of raw.types) {
    if (typeIds.has(type.name)) {
      warn(type.origin, `Type "${type.name}" is defined more than once; the first definition is kept.`)
    } else {
      typeIds.set(type.name, newId())
    }
  }
  const resolveType = (type: RawType, origin: Origin): ColumnType => {
    if (type.kind === 'named') {
      const typeId = typeIds.get(type.name)
      if (typeId !== undefined) return { kind: 'user', typeId }
      warn(origin, `Unknown type "${type.name}" is imported as text.`)
      return { kind: 'text' }
    }
    if (type.kind === 'array') {
      const element = resolveType(type.of, origin)
      return element.kind === 'array' ? element : { kind: 'array', of: element }
    }
    return type
  }
  const addedTypes = new Set<string>()
  for (const type of raw.types) {
    if (addedTypes.has(type.name)) continue
    addedTypes.add(type.name)
    const id = typeIds.get(type.name) as string
    schema = addType(
      schema,
      type.kind === 'enum'
        ? { kind: 'enum', id, name: type.name, values: type.values }
        : {
            kind: 'domain',
            id,
            name: type.name,
            base: resolveType(type.base, type.origin),
            ...(type.notNull ? { notNull: true } : {}),
            ...(type.default === undefined ? {} : { default: type.default }),
          }
    )
  }

  // ---- defaults and identities that pg_dump writes as ALTER COLUMN
  const defaultOverrides = new Map<string, string>()
  const identities = new Set<string>()
  for (const alter of raw.alters) {
    if ('setDefault' in alter) {
      defaultOverrides.set(`${alter.table}.${alter.setDefault.column}`, alter.setDefault.expression)
    } else if ('identity' in alter) {
      identities.add(`${alter.table}.${alter.identity}`)
    }
  }

  const interpret = (
    table: string,
    column: RawColumn,
    type: ColumnType,
    origin: Origin
  ): { generated: boolean; default?: string } => {
    const key = `${table}.${column.name}`
    const supported = (GENERATED_COLUMN_KINDS as readonly string[]).includes(type.kind)
    if (column.generated || identities.has(key)) {
      if (!supported) {
        warn(origin, `Column "${table}.${column.name}" is an identity or serial of type ${type.kind}, which Forge cannot generate; it is imported as a plain column.`)
        return { generated: false }
      }
      return { generated: true }
    }
    const text = (defaultOverrides.get(key) ?? column.default)?.trim()
    if (text === undefined || text === '') return { generated: false }
    const lower = text.toLowerCase()
    if ((type.kind === 'integer' || type.kind === 'bigint') && SEQUENCE_DEFAULT.test(lower)) {
      warn(origin, `The sequence default of "${table}.${column.name}" is imported as an identity column.`)
      return { generated: true }
    }
    if (type.kind === 'timestamp' && NOW_DEFAULT.test(lower)) return { generated: true }
    if (type.kind === 'uuid' && UUID_DEFAULT.test(lower)) return { generated: true }
    return { generated: false, default: text }
  }

  // ---- tables and columns
  const tables = new Map<string, BuiltTable>()
  for (const rawTable of raw.tables) {
    if (tables.has(rawTable.name)) {
      warn(rawTable.origin, `Table "${rawTable.name}" is defined more than once; the first definition is kept.`)
      continue
    }
    const tableId = newId()
    schema = addTable(schema, { id: tableId, name: rawTable.name })
    const alteredKey = raw.alters.find(
      (alter) => alter.table === rawTable.name && 'primaryKey' in alter
    )
    const keyNames =
      alteredKey && 'primaryKey' in alteredKey
        ? alteredKey.primaryKey
        : rawTable.primaryKey.length > 0
          ? rawTable.primaryKey
          : rawTable.columns.filter((c) => c.primaryKey).map((c) => c.name)

    const columnIds = new Map<string, string>()
    for (const column of rawTable.columns) {
      if (columnIds.has(column.name)) {
        warn(rawTable.origin, `Column "${rawTable.name}.${column.name}" is defined more than once; the first one is kept.`)
        continue
      }
      const type = resolveType(column.type, rawTable.origin)
      const { generated, default: fallback } = interpret(rawTable.name, column, type, rawTable.origin)
      const identityIsRequired = generated && (type.kind === 'integer' || type.kind === 'bigint')
      const id = newId()
      columnIds.set(column.name, id)
      schema = addColumn(schema, tableId, {
        id,
        name: column.name,
        type,
        nullable: !(column.notNull || keyNames.includes(column.name) || identityIsRequired),
        ...(generated ? { generated: true } : {}),
        ...(fallback === undefined ? {} : { default: fallback }),
      })
    }
    const keyIds: string[] = []
    for (const name of keyNames) {
      const id = columnIds.get(name)
      if (id === undefined) {
        warn(rawTable.origin, `The primary key of "${rawTable.name}" uses the unknown column "${name}".`)
      } else {
        keyIds.push(id)
      }
    }
    schema = setPrimaryKey(schema, tableId, keyIds)
    tables.set(rawTable.name, { id: tableId, raw: rawTable, columnIds })
  }

  // ---- indexes
  const usedIndexNames = new Set<string>()
  const freeIndexName = (base: string, origin: Origin, written: boolean): string => {
    let name = base
    for (let attempt = 2; usedIndexNames.has(name); attempt++) name = `${base}_${attempt}`
    if (name !== base && written) {
      warn(origin, `Index name "${base}" is already used; this one is named "${name}".`)
    }
    usedIndexNames.add(name)
    return name
  }
  const addIndexOn = (
    tableName: string,
    origin: Origin,
    columnNames: string[],
    unique: boolean,
    method: string,
    writtenName?: string
  ) => {
    const built = tables.get(tableName)
    if (!built) {
      warn(origin, `An index on the unknown table "${tableName}" was ignored.`)
      return
    }
    const columns: string[] = []
    for (const name of columnNames) {
      const id = built.columnIds.get(name)
      if (id === undefined) {
        warn(origin, `An index on "${tableName}" uses the unknown column "${name}" and was ignored.`)
        return
      }
      columns.push(id)
    }
    const present = schema.tables.find((table) => table.id === built.id)?.indexes ?? []
    if (unique && present.some((index) => index.unique && sameIds(index.columns, columns))) return
    const base = writtenName ?? `${unique ? 'uq' : 'idx'}_${tableName}_${columnNames.join('_')}`
    schema = addIndex(schema, built.id, {
      id: newId(),
      name: freeIndexName(base, origin, writtenName !== undefined),
      columns,
      unique,
      method: method as 'btree' | 'hash' | 'gin' | 'gist',
    })
  }
  for (const { raw: rawTable } of tables.values()) {
    for (const column of rawTable.columns) {
      if (column.unique) addIndexOn(rawTable.name, rawTable.origin, [column.name], true, 'btree')
    }
    for (const unique of rawTable.uniques) {
      addIndexOn(rawTable.name, rawTable.origin, unique.columns, true, 'btree', unique.name)
    }
  }
  for (const alter of raw.alters) {
    if ('unique' in alter) {
      addIndexOn(alter.table, alter.origin, alter.unique.columns, true, 'btree', alter.unique.name)
    }
  }
  for (const index of raw.indexes) {
    addIndexOn(index.table, index.origin, index.columns, index.unique, index.method, index.name)
  }

  // ---- foreign keys
  const keys: ForeignKey[] = []
  for (const { raw: rawTable } of tables.values()) {
    for (const column of rawTable.columns) {
      if (column.reference) {
        keys.push({ origin: rawTable.origin, table: rawTable.name, columns: [column.name], reference: column.reference })
      }
    }
    for (const key of rawTable.foreignKeys) {
      keys.push({ origin: rawTable.origin, table: rawTable.name, ...key })
    }
  }
  for (const alter of raw.alters) {
    if ('foreignKey' in alter) {
      keys.push({ origin: alter.origin, table: alter.table, ...alter.foreignKey })
    }
  }
  for (const key of keys) {
    const label = `${key.table}.${key.columns.join(', ')}`
    const from = tables.get(key.table)
    const to = tables.get(key.reference.table)
    if (!from) {
      warn(key.origin, `A foreign key on the unknown table "${key.table}" was ignored.`)
      continue
    }
    if (!to) {
      warn(key.origin, `The foreign key ${label} references the unknown table "${key.reference.table}" and was ignored.`)
      continue
    }
    if (key.columns.length !== 1 || key.reference.columns.length > 1) {
      warn(key.origin, `The foreign key ${label} is composite, which is not modelled; it was ignored.`)
      continue
    }
    const fromColumn = from.columnIds.get(key.columns[0] as string)
    if (fromColumn === undefined) {
      warn(key.origin, `The foreign key ${label} uses an unknown column and was ignored.`)
      continue
    }
    const target = schema.tables.find((table) => table.id === to.id)
    const toColumn =
      key.reference.columns.length === 0
        ? target?.primaryKey.length === 1
          ? target.primaryKey[0]
          : undefined
        : to.columnIds.get(key.reference.columns[0] as string)
    if (toColumn === undefined) {
      warn(key.origin, `The foreign key ${label} points to a column of "${key.reference.table}" that does not exist, or to a table without a single primary key; it was ignored.`)
      continue
    }
    const from_ = { tableId: from.id, columnId: fromColumn }
    const to_ = { tableId: to.id, columnId: toColumn }
    const issue = checkRelationship(schema, from_, to_)
    if (issue) {
      warn(key.origin, `The foreign key ${label} was ignored: ${issue.message}`)
      continue
    }
    schema = addRelationship(schema, { id: newId(), from: from_, to: to_ })
    if (key.reference.actions) {
      warn(key.origin, `ON DELETE / ON UPDATE actions of the foreign key ${label} are not modelled and were ignored.`)
    }
  }

  // ---- comments
  for (const comment of raw.comments) {
    const built = tables.get(comment.table)
    if (!built) {
      warn(comment.origin, `A comment on the unknown table "${comment.table}" was ignored.`)
      continue
    }
    if (comment.text.trim() === '') continue
    if (comment.column === undefined) {
      schema = setTableComment(schema, built.id, comment.text)
      continue
    }
    const columnId = built.columnIds.get(comment.column)
    if (columnId === undefined) {
      warn(comment.origin, `A comment on the unknown column "${comment.table}.${comment.column}" was ignored.`)
      continue
    }
    schema = updateColumn(schema, built.id, columnId, { comment: comment.text })
  }

  return schema
}
```

Biome may rename the `from_`/`to_` locals; keep them readable (`source`/`target`) if it complains.

- [ ] **Step 4: Implement `import-sql.ts`**

```ts
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
  const addWarning = (message: ImportMessage) => {
    const key = `${message.line}|${message.statement}|${message.message}`
    if (seen.has(key)) return
    seen.add(key)
    warnings.push(message)
  }

  const { tokens, errors: lexical } = tokenize(sql)
  for (const error of lexical) {
    errors.push({ line: error.line, statement: '', message: error.message })
  }

  const raw = emptyScript()
  for (const statement of splitStatements(sql, tokens)) {
    const preview = previewOf(statement.text)
    try {
      parseStatement(statement, sql, raw, (line, message) => {
        addWarning({ line, statement: preview, message })
      })
    } catch (error) {
      if (!(error instanceof ParseFailure)) throw error
      errors.push({ line: error.line, statement: preview, message: error.message })
    }
  }

  const schema = buildSchema(raw, newId, (origin, message) => {
    addWarning({ line: origin.line, statement: origin.text, message })
  })
  for (const issue of validate(schema)) {
    errors.push({ line: 0, statement: '', message: issue.message })
  }
  return { schema, warnings, errors }
}
```

Export from `packages/core/src/index.ts`: `export type { ImportMessage, ImportResult } from './sql/parse/import-sql.ts'` and `export { importSql } from './sql/parse/import-sql.ts'`.

- [ ] **Step 5: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write packages 2>&1 | tail -2; pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/core typecheck 2>&1 | grep -c error`
Expected: all pass, 0 type errors. A failing "does not repeat the same warning" or "primary key" test usually means a message differs from the one asserted: change the code, not the assertion, unless the assertion contradicts the rules listed above.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): build a schema from a SQL script (importSql)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: A `pg_dump` corpus, the round trip, docs and the gate

**Files:**
- Test: `packages/core/src/tests/integration/sql/import-corpus.test.ts` (new), `packages/core/src/tests/integration/sql/import-round-trip.test.ts` (new)
- Create: `packages/core/docs/adr/0008-sql-import-parser.md`
- Modify: `packages/core/GLOSSARY.md`

**Interfaces:**
- Consumes: `importSql`, `generateDdl`, `postgres`, the model operations.
- Produces: the evidence that the parser reads real scripts and what Forge writes; the docs.

- [ ] **Step 1: Write the corpus test**

`import-corpus.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { importSql } from '../../../sql/parse/import-sql.ts'

let counter = 0
const run = (sql: string) => importSql(sql, () => `id-${++counter}`)

/** The shape of a script produced by `pg_dump --schema-only`, with a data block. */
const DUMP = `--
-- PostgreSQL database dump
--

\\restrict abc123

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SELECT pg_catalog.set_config('search_path', '', false);

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'paid',
    'it''s shipped'
);

CREATE DOMAIN public.email AS character varying(255)
    CONSTRAINT email_check CHECK (((VALUE)::text ~~ '%@%'::text));

CREATE FUNCTION public.touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.users (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    email public.email NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bio text
);

COMMENT ON TABLE public.users IS 'People who can order';
COMMENT ON COLUMN public.users.email IS 'Login address; unique';

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

CREATE TABLE public.orders (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    total numeric(12,2),
    note character varying,
    tags text[] DEFAULT '{}'::text[],
    CONSTRAINT orders_total_check CHECK ((total >= (0)::numeric))
);

CREATE TABLE public.order_items (
    order_id bigint NOT NULL,
    line integer NOT NULL,
    qty integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

COPY public.users (id, name, email, created_at, bio) FROM stdin;
1	Ana; the first	ana@example.com	2024-01-01 00:00:00+00	\\N
2	Bob	bob@example.com	2024-01-02 00:00:00+00	has; semicolons; and 'quotes'
\\.

INSERT INTO public.order_items VALUES (1, 1, 1);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (order_id, line);

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);
CREATE INDEX idx_orders_status_paid ON public.orders USING btree (status) WHERE (status = 'paid'::public.order_status);
CREATE INDEX idx_users_lower_name ON public.users USING btree (lower((name)::text));

CREATE TRIGGER users_touch BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.touch();

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);

--
-- PostgreSQL database dump complete
--
`

describe('importSql: a pg_dump script', () => {
  const result = run(DUMP)
  const table = (name: string) => result.schema.tables.find((t) => t.name === name)

  it('has no errors', () => {
    assert.deepEqual(result.errors, [])
  })

  it('imports the tables, in order, and nothing from the data block', () => {
    assert.deepEqual(result.schema.tables.map((t) => t.name), ['users', 'orders', 'order_items'])
  })

  it('imports the types and what uses them', () => {
    assert.deepEqual(result.schema.types?.map((t) => [t.kind, t.name]), [
      ['enum', 'order_status'],
      ['domain', 'email'],
    ])
    const status = table('orders')?.columns.find((c) => c.name === 'status')
    assert.equal(status?.type.kind, 'user')
    assert.equal(status?.default, "'pending'::public.order_status")
    const enumType = result.schema.types?.[0]
    assert.deepEqual(enumType?.kind === 'enum' && enumType.values, ['pending', 'paid', "it's shipped"])
  })

  it('reads the sequence default set by ALTER COLUMN as an identity, and now() as generated', () => {
    const users = table('users')
    assert.equal(users?.columns.find((c) => c.name === 'id')?.generated, true)
    assert.equal(users?.columns.find((c) => c.name === 'created_at')?.generated, true)
    assert.deepEqual(users?.primaryKey, [users?.columns[0]?.id])
  })

  it('reads composite primary keys, uniques, indexes and comments', () => {
    assert.equal(table('order_items')?.primaryKey.length, 2)
    assert.deepEqual(table('users')?.indexes?.map((i) => [i.name, i.unique]), [['users_email_key', true]])
    assert.deepEqual(table('orders')?.indexes?.map((i) => i.name), ['idx_orders_user'])
    assert.equal(table('users')?.comment, 'People who can order')
    assert.equal(table('users')?.columns.find((c) => c.name === 'email')?.comment, 'Login address; unique')
  })

  it('keeps both foreign keys, and warns about the cascade', () => {
    assert.equal(result.schema.relationships.length, 2)
    assert.ok(result.warnings.some((w) => w.message.includes('ON DELETE')))
  })

  it('warns, with lines, about everything Forge does not model', () => {
    const text = result.warnings.map((w) => w.message).join('\n')
    for (const fragment of [
      'SET',
      'SELECT',
      'CREATE EXTENSION',
      'COMMENT ON EXTENSION',
      'CREATE FUNCTION',
      'CREATE SEQUENCE',
      'ALTER SEQUENCE',
      'INSERT INTO',
      'CREATE TRIGGER',
      'CHECK',
      'idx_orders_status_paid',
      'idx_users_lower_name',
    ]) {
      assert.ok(text.includes(fragment), `no warning mentions ${fragment}`)
    }
    assert.ok(result.warnings.every((w) => w.line >= 1))
  })

  it('imports every statement even when the data block holds semicolons and quotes', () => {
    assert.equal(table('order_items')?.columns.length, 3)
  })
})
```

- [ ] **Step 2: Write the round-trip test**

`import-round-trip.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import {
  addColumn,
  addIndex,
  addRelationship,
  addTable,
  addType,
  createSchema,
  setPrimaryKey,
  setTableComment,
} from '../../../schema/operations.ts'
import type { Schema } from '../../../schema/types.ts'
import { generateDdl } from '../../../sql/generate/generate-ddl.ts'
import { importSql } from '../../../sql/parse/import-sql.ts'

/** A schema with ids replaced by names, so two schemas can be compared. */
function normalize(schema: Schema) {
  const typeName = (id: string) => schema.types?.find((t) => t.id === id)?.name
  const describeType = (type: Schema['tables'][number]['columns'][number]['type']): unknown => {
    if (type.kind === 'user') return { kind: 'user', name: typeName(type.typeId) }
    if (type.kind === 'array') return { kind: 'array', of: describeType(type.of) }
    return type
  }
  return {
    types: (schema.types ?? []).map((t) =>
      t.kind === 'enum'
        ? { kind: t.kind, name: t.name, values: t.values }
        : { kind: t.kind, name: t.name, base: describeType(t.base), notNull: t.notNull ?? false, default: t.default ?? null }
    ),
    tables: schema.tables.map((table) => {
      const name = (id: string) => table.columns.find((c) => c.id === id)?.name
      return {
        name: table.name,
        comment: table.comment ?? null,
        primaryKey: table.primaryKey.map(name),
        columns: table.columns.map((c) => ({
          name: c.name,
          type: describeType(c.type),
          // A primary key and an integer identity are NOT NULL whatever the model says.
          notNull:
            !c.nullable ||
            table.primaryKey.includes(c.id) ||
            (c.generated === true && (c.type.kind === 'integer' || c.type.kind === 'bigint')),
          generated: c.generated ?? false,
          default: c.default ?? null,
          comment: c.comment ?? null,
        })),
        indexes: (table.indexes ?? []).map((i) => ({
          name: i.name,
          columns: i.columns.map(name),
          unique: i.unique,
          method: i.method,
        })),
      }
    }),
    relationships: schema.relationships.map((r) => {
      const from = schema.tables.find((t) => t.id === r.from.tableId)
      const to = schema.tables.find((t) => t.id === r.to.tableId)
      return [
        `${from?.name}.${from?.columns.find((c) => c.id === r.from.columnId)?.name}`,
        `${to?.name}.${to?.columns.find((c) => c.id === r.to.columnId)?.name}`,
      ]
    }),
  }
}

function sample(): Schema {
  let s = addType(createSchema(), { kind: 'enum', id: 'e1', name: 'order status', values: ['new', "won't ship"] })
  s = addType(s, { kind: 'domain', id: 'd1', name: 'shade', base: { kind: 'user', typeId: 'e1' }, default: "'new'", notNull: true })
  s = addTable(s, { id: 'u', name: 'users' })
  s = addColumn(s, 'u', { id: 'u1', name: 'id', type: { kind: 'integer' }, nullable: false, generated: true })
  s = addColumn(s, 'u', { id: 'u2', name: 'email', type: { kind: 'varchar', length: 255 }, nullable: false, comment: "the user's login" })
  s = addColumn(s, 'u', { id: 'u3', name: 'created_at', type: { kind: 'timestamp' }, nullable: false, generated: true })
  s = addColumn(s, 'u', { id: 'u4', name: 'born', type: { kind: 'timestamp_no_tz' }, nullable: true })
  s = addColumn(s, 'u', { id: 'u5', name: 'score', type: { kind: 'numeric', precision: 10, scale: 2 }, nullable: true, default: '0' })
  s = addColumn(s, 'u', { id: 'u6', name: 'tags', type: { kind: 'array', of: { kind: 'text' } }, nullable: true })
  s = addColumn(s, 'u', { id: 'u7', name: 'mood', type: { kind: 'user', typeId: 'e1' }, nullable: true })
  s = addColumn(s, 'u', { id: 'u8', name: 'code', type: { kind: 'char', length: 3 }, nullable: true })
  s = addColumn(s, 'u', { id: 'u9', name: 'ratio', type: { kind: 'double' }, nullable: true })
  s = setPrimaryKey(s, 'u', ['u1'])
  s = setTableComment(s, 'u', 'People')
  s = addIndex(s, 'u', { id: 'i1', name: 'uq_users_email', columns: ['u2'], unique: true, method: 'btree' })
  s = addIndex(s, 'u', { id: 'i2', name: 'idx_users_tags', columns: ['u6'], unique: false, method: 'gin' })
  s = addTable(s, { id: 'o', name: 'orders' })
  s = addColumn(s, 'o', { id: 'o1', name: 'id', type: { kind: 'uuid' }, nullable: false, generated: true })
  s = addColumn(s, 'o', { id: 'o2', name: 'user_id', type: { kind: 'integer' }, nullable: false })
  s = setPrimaryKey(s, 'o', ['o1'])
  s = addIndex(s, 'o', { id: 'i3', name: 'idx_orders_user', columns: ['o2'], unique: false, method: 'btree' })
  return addRelationship(s, { id: 'r', from: { tableId: 'o', columnId: 'o2' }, to: { tableId: 'u', columnId: 'u1' } })
}

describe('importSql reads back what generateDdl writes', () => {
  it('gives the same schema, apart from ids', () => {
    const original = sample()
    const ddl = generateDdl(original, postgres)
    assert.equal(ddl.ok, true)
    if (!ddl.ok) return
    let counter = 0
    const result = importSql(ddl.sql, () => `x-${++counter}`)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(normalize(result.schema), normalize(original))
  })

  it('reads its own output a second time to the same DDL', () => {
    const first = generateDdl(sample(), postgres)
    assert.equal(first.ok, true)
    if (!first.ok) return
    let counter = 0
    const imported = importSql(first.sql, () => `y-${++counter}`)
    const second = generateDdl(imported.schema, postgres)
    assert.equal(second.ok, true)
    if (second.ok) assert.equal(second.sql, first.sql)
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write packages 2>&1 | tail -2; pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"`
Expected: the corpus and round-trip tests either pass or fail on a real gap in the parser. These two files are written after the implementation, so a failure is a finding, not a formality: for each failure find the cause (systematic debugging), fix the **parser** (or builder), and re-run. Do not weaken an assertion to make it pass unless it contradicts a rule in this plan; if it does, record a `Ruling:` in the ledger. Typical gaps to expect: the `\\restrict` meta-line, `SELECT pg_catalog.set_config` naming, `CREATE FUNCTION … $$ … $$` splitting, the `DEFAULT '{}'::text[]` expression, and index names that collide with unique constraint names.

- [ ] **Step 4: Docs**

`packages/core/docs/adr/0008-sql-import-parser.md`: status accepted. Context: the app must create tables and relationships from pasted or loaded SQL. Decision: a hand-written parser in the core (tokenizer → statement splitter → per-statement recursive descent → builder), with no dependencies; the builder applies Forge's own relationship rules (`checkRelationship`) and `validate`; unsupported syntax is a warning with its line, a broken statement an error, and the others still import; unquoted names fold to lower case; what Forge generates reads back to the same schema (round-trip test). List the rejected alternative (a PostgreSQL parser library, WASM or heavy, positions in bytes, and it breaks "core without dependencies") and the consequences (the supported subset is stated in the glossary; gaps are found with the corpus test; CHECK, partial and expression indexes, composite foreign keys, composite types stay warnings).

`packages/core/GLOSSARY.md`: add **Import**: reading a SQL script into a Schema with `importSql`; returns the schema, **warnings** (valid SQL that Forge does not model, with its line) and **errors** (a statement it should understand but cannot, or an invalid result). List the statements read (`CREATE TABLE`, `ALTER TABLE … ADD CONSTRAINT`/`ALTER COLUMN … SET DEFAULT`/`ADD GENERATED`, `CREATE [UNIQUE] INDEX`, `CREATE TYPE … AS ENUM`, `CREATE DOMAIN`, `COMMENT ON TABLE/COLUMN`).

- [ ] **Step 5: Final gate**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint && pnpm typecheck && pnpm test 2>&1 | grep -E "ℹ (tests|pass|fail)" && pnpm build 2>&1 | tail -1`
Expected: all green. (The e2e suite is unaffected: nothing in `apps/` changed.)

- [ ] **Step 6: Commit**

```bash
git add -A packages docs
git commit -m "test(core): a pg_dump corpus and the round trip for importSql; ADR and glossary

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
