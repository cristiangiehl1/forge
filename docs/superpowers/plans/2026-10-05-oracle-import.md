# Reading Oracle SQL, and a type system per database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The engine knows the types of each database both ways: new logical type `number`, a `native` type for what has no logical one, an Oracle reader (`importSql(sql, newId, 'oracle')`) that follows the team's migrations, upper-case names from Oracle, a "Read as" choice in the import dialog, and a bundled "recruitment system" example read from the real migrations.

**Architecture:** `ColumnType` gains `number` and `native`; every dialect writer handles them (with notes across dialects). The SQL reader becomes dialect-aware: `Cursor` carries the dialect (and folds plain names by its rule), the type reader is one module per dialect behind a dispatcher, the tokenizer skips Oracle's `/` lines, `CHECK` hints (`IN (0,1)`, `IS JSON`) refine types in the builder, and unknown types become `native`. The web gains the selector option, a "Read as" select and a second example.

**Tech Stack:** TypeScript 7 (`node:test`, type stripping, `erasableSyntaxOnly`: no constructor parameter properties, no enums), React 19 + React Compiler (no `useMemo`/`useCallback`/`memo`), Zustand, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-05-oracle-import-design.md`. Built on the model, parser, dialect and import-dialog work already on `main`.

## Global Constraints

- Run Node through mise: prefix every command with `export PATH="$(mise where node)/bin:$PATH"`; absolute paths; run from `/home/cristian.giehl@koch.intranet/orca/projects/forge`.
- Tests: `packages/core/src/tests/{unit,integration}/**`, `apps/web/src/tests/unit/**`, `apps/e2e/tests/*.spec.ts`, never colocated. Core: `pnpm --filter @forge/core test`; web: `pnpm --filter @forge/web test`; e2e: `cd apps/e2e && pnpm exec playwright test --workers=3`. Gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` and the e2e.
- Style: `pnpm exec biome check --write apps packages` (single quotes, no semicolons). Never put a comment in `biome.json`. The core is platform-free and has no dependencies. React Compiler: no `useMemo`/`useCallback`/`memo`.
- Work on a branch (`feat/oracle-import`), not `main`. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.
- **PostgreSQL output and PostgreSQL reading do not change**, except the two changes this plan names: bare `numeric` is read as `number`, and an unknown PostgreSQL type is read as `native` instead of `text`. Existing tests change only where those two apply.
- The project format stays `formatVersion` 1; `number` and `native` are new values of an existing field.
- Node geometry is fixed (width 220, title 31, rows 26, border 1).
- The Oracle migrations come from `/home/cristian.giehl@koch.intranet/Projetos/sistema-recrutamento-selecao/apps/api/src/infra/database/oracle/migrations/00*.sql` (the DDL files; `seeds/` is not read). Read several of them before writing the reader tests.

## Rulings made while planning

- **Names from Oracle are upper case**, not lower (the user's instruction): `Cursor.identifier` folds a plain word by the script's dialect; quoted names keep their case. PostgreSQL keeps folding to lower case.
- **`NUMBER(1)` is read as `smallint`; only a `CHECK (c IN (0,1))` makes it `boolean`** (and only `IS JSON` makes a text column `json`). Nothing else is inferred from a `CHECK`; an enum written as `IN ('A','B')` stays `varchar` with a warning.
- **A generated `number` is written `bigint` in PostgreSQL**, with a note (`identity-as-bigint`), because PostgreSQL has identity only on integer types.
- **A native type in another database becomes `text` (PostgreSQL) or `CLOB` (Oracle)** with a note (`native-type`).
- **A boolean's Oracle default `1`/`0` is read as `true`/`false`** so a PostgreSQL script from the same model is valid; the Oracle writer translates it back.
- **The bundled example is a copy of the DDL migrations** (a generated TypeScript module holding the SQL as a string, so it needs no bundler feature and tests read it in Node). It is the user's own internal schema, copied at their request; remove `recruitment-sql.ts` and the button to take it out.
- **The reader does not read PL/SQL blocks**: each `;`-separated piece is a warning.

## Review Focus

1. Every type in the spec's table is read to the model type shown, and the Oracle script generated from the result reads back to the same schema (round trip) (Task 2, Task 4).
2. `number` and `native` survive the project file, validation, foreign-key compatibility and both dialect writers (Task 1).
3. PostgreSQL scripts read exactly as before, except the two named changes (Task 2).
4. Names from Oracle are upper case; quoted names keep their case; `ALTER`, `COMMENT` and `CREATE INDEX` find the tables they name (Task 2).
5. An unknown type is `native` with the script's dialect, never a silent `text` (Task 2).
6. The real migrations import with no errors; each warning is explainable (Task 4).
7. A project with 50+ tables loads, lays out and routes without freezing the page (Task 4).

---

### Task 1: The types `number` and `native`

**Files:**
- Modify: `packages/core/src/schema/types.ts`, `schema/type-shape.ts`, `schema/validate.ts`, `project/parse-project.ts`, `dialects/postgres.ts`, `dialects/oracle.ts`, `index.ts`
- Test: `packages/core/src/tests/unit/schema/number-native.test.ts`, `packages/core/src/tests/integration/sql/number-native-ddl.test.ts` (new)

**Interfaces:**
- Produces:
  - `SIMPLE_COLUMN_KINDS` gains `'number'` (after `'smallint'`); `GENERATED_COLUMN_KINDS` gains `'number'`.
  - `ColumnType` gains `{ kind: 'native'; dialect: DialectId; text: string }` (import `DialectId` as a type from `../dialects/dialect.ts`).
  - `sameTypeShape`: two natives are the same when `dialect` and `text` (case-insensitive) are.
  - `IssueCode` gains `'empty-native-type'` (a native `text` that is blank, in a column or a domain base).
  - `parseProject` reads `{ kind: 'native', dialect, text }` (dialect in `DIALECT_IDS`, text a non-blank string, else an error at the type's path) and `number` (through `SIMPLE_COLUMN_KINDS`).
  - Writers: PostgreSQL `number` → `numeric`, `native` of `postgres` → its text, any other native → `text` + note `native-type`; a generated `number` → `bigint` + note `identity-as-bigint` and `GENERATED BY DEFAULT AS IDENTITY`; `generatedImpliesNotNull('number')` is true. Oracle `number` → `NUMBER`; `native` of `oracle` → its text (not a LOB), any other native → `CLOB` (a LOB) + note `native-type`; generated `number` → the identity clause, implies `NOT NULL`.

- [ ] **Step 1: Write the failing tests**

`number-native.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseProject } from '../../../project/parse-project.ts'
import { sameTypeShape } from '../../../schema/type-shape.ts'
import type { ColumnType, Schema } from '../../../schema/types.ts'
import { GENERATED_COLUMN_KINDS, SIMPLE_COLUMN_KINDS } from '../../../schema/types.ts'
import { validate } from '../../../schema/validate.ts'

const schemaWith = (type: ColumnType, generated = false): Schema => ({
  version: 1,
  tables: [{ id: 't', name: 'x', columns: [{ id: 'c', name: 'c', type, nullable: true, ...(generated ? { generated } : {}) }], primaryKey: [] }],
  relationships: [],
})

describe('the kinds', () => {
  it('number is a simple kind and can be generated', () => {
    assert.ok((SIMPLE_COLUMN_KINDS as readonly string[]).includes('number'))
    assert.ok((GENERATED_COLUMN_KINDS as readonly string[]).includes('number'))
  })
})

describe('validate: native types', () => {
  it('accepts a native with text and flags one with none', () => {
    assert.deepEqual(validate(schemaWith({ kind: 'native', dialect: 'oracle', text: 'NVARCHAR2(10)' })), [])
    const issues = validate(schemaWith({ kind: 'native', dialect: 'oracle', text: '  ' }))
    assert.deepEqual(issues.map((i) => i.code), ['empty-native-type'])
    assert.equal(issues[0]?.columnId, 'c')
  })

  it('accepts a generated number, and still refuses generated text', () => {
    assert.deepEqual(validate(schemaWith({ kind: 'number' }, true)), [])
    assert.deepEqual(validate(schemaWith({ kind: 'text' }, true)).map((i) => i.code), ['generated-unsupported-type'])
  })
})

describe('sameTypeShape: native', () => {
  it('compares dialect and text, ignoring case', () => {
    const a: ColumnType = { kind: 'native', dialect: 'oracle', text: 'ROWID' }
    assert.equal(sameTypeShape(a, { kind: 'native', dialect: 'oracle', text: 'rowid' }), true)
    assert.equal(sameTypeShape(a, { kind: 'native', dialect: 'postgres', text: 'ROWID' }), false)
    assert.equal(sameTypeShape(a, { kind: 'native', dialect: 'oracle', text: 'XMLTYPE' }), false)
    assert.equal(sameTypeShape({ kind: 'number' }, { kind: 'number' }), true)
    assert.equal(sameTypeShape({ kind: 'number' }, { kind: 'numeric', precision: 5, scale: 0 }), false)
  })
})

describe('parseProject: number and native', () => {
  const project = (type: object) => ({
    formatVersion: 1,
    schema: { version: 1, tables: [{ id: 't', name: 'x', columns: [{ id: 'c', name: 'c', type, nullable: true }], primaryKey: [] }], relationships: [] },
    view: null,
  })

  it('reads both', () => {
    for (const type of [{ kind: 'number' }, { kind: 'native', dialect: 'oracle', text: 'XMLTYPE' }]) {
      const result = parseProject(project(type))
      assert.equal(result.ok, true, JSON.stringify(type))
      if (result.ok) assert.deepEqual(result.project.schema.tables[0]?.columns[0]?.type, type)
    }
  })

  it('rejects a native with an unknown dialect, a missing or a non-string text', () => {
    for (const type of [
      { kind: 'native', dialect: 'mysql', text: 'x' },
      { kind: 'native', dialect: 'oracle' },
      { kind: 'native', dialect: 'oracle', text: 3 },
      { kind: 'native', text: 'x' },
    ]) {
      assert.equal(parseProject(project(type)).ok, false, JSON.stringify(type))
    }
  })
})
```

`number-native-ddl.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { oracle } from '../../../dialects/oracle.ts'
import { postgres } from '../../../dialects/postgres.ts'
import type { Column, ColumnType, Schema } from '../../../schema/types.ts'
import { generateDdl } from '../../../sql/generate/generate-ddl.ts'

const col = (id: string, name: string, type: ColumnType, extra: Partial<Column> = {}): Column => ({ id, name, type, nullable: true, ...extra })
const schemaOf = (columns: Column[], primaryKey: string[] = []): Schema => ({
  version: 1,
  tables: [{ id: 't', name: 'jobs', columns, primaryKey }],
  relationships: [],
})
const run = (schema: Schema, dialect: typeof postgres) => {
  const result = generateDdl(schema, dialect)
  assert.equal(result.ok, true)
  return result.ok ? result : { sql: '', notes: [], statements: [] }
}

describe('number and native in PostgreSQL', () => {
  const schema = schemaOf([
    col('a', 'id', { kind: 'number' }, { nullable: false, generated: true }),
    col('b', 'latitude', { kind: 'number' }),
    col('c', 'weird', { kind: 'native', dialect: 'postgres', text: 'inet' }),
    col('d', 'rowid', { kind: 'native', dialect: 'oracle', text: 'ROWID' }),
  ], ['a'])

  it('writes number as numeric, a generated number as bigint with a note, and natives by dialect', () => {
    const { sql, notes } = run(schema, postgres)
    assert.ok(sql.includes('"id" bigint NOT NULL GENERATED BY DEFAULT AS IDENTITY'), sql)
    assert.ok(sql.includes('"latitude" numeric,'), sql)
    assert.ok(sql.includes('"weird" inet,'), sql)
    assert.ok(sql.includes('"rowid" text'), sql)
    assert.deepEqual(notes.map((n) => [n.code, n.columnId]), [['identity-as-bigint', 'a'], ['native-type', 'd']])
  })
})

describe('number and native in Oracle', () => {
  const schema = schemaOf([
    col('a', 'id', { kind: 'number' }, { nullable: false, generated: true }),
    col('b', 'latitude', { kind: 'number' }),
    col('c', 'name', { kind: 'native', dialect: 'oracle', text: 'NVARCHAR2(100)' }),
    col('d', 'weird', { kind: 'native', dialect: 'postgres', text: 'inet' }),
  ], ['a'])

  it('writes NUMBER, an identity on it, an Oracle native as it is, and another native as a CLOB with a note', () => {
    const { sql, notes } = run(schema, oracle())
    assert.ok(sql.includes('ID NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,'), sql)
    assert.ok(sql.includes('LATITUDE NUMBER,'), sql)
    assert.ok(sql.includes('NAME NVARCHAR2(100),'), sql)
    assert.ok(sql.includes('WEIRD CLOB'), sql)
    assert.deepEqual(notes.map((n) => [n.code, n.columnId]), [['native-type', 'd']])
  })

  it('does not let a native of another database be a key', () => {
    const keyed = schemaOf([col('a', 'k', { kind: 'native', dialect: 'postgres', text: 'inet' })], ['a'])
    const result = generateDdl(keyed, oracle())
    assert.equal(result.ok, false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/schema/number-native.test.ts src/tests/integration/sql/number-native-ddl.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`types.ts`: add `'number'` to `SIMPLE_COLUMN_KINDS` (after `'smallint'`) and `GENERATED_COLUMN_KINDS`; add to `ColumnType`: `| { kind: 'native'; dialect: DialectId; text: string }` with `import type { DialectId } from '../dialects/dialect.ts'`.

`type-shape.ts`: in `sameTypeShape`, after the `user` branch: `if (a.kind === 'native' && b.kind === 'native') return a.dialect === b.dialect && a.text.trim().toLowerCase() === b.text.trim().toLowerCase()`.

`validate.ts`: add `'empty-native-type'` to `IssueCode`; in the column loop (next to `unknown-type`) push `issue('empty-native-type', \`Column "${table.name}.${column.name}" has a native type with no text.\`, ids)` when the type (or the element of an array) is a native with a blank text; the same for a domain's `base` in the types loop (ids `{ typeId }`).

`parse-project.ts` `parseType`: after the `user` branch add

```ts
  if (kind === 'native') {
    const dialect = raw.dialect
    const text = raw.text
    if (typeof dialect !== 'string' || !(DIALECT_IDS as readonly string[]).includes(dialect)) {
      fail(`${path}.dialect`, `A native type needs a "dialect" of ${DIALECT_IDS.join(', ')}.`)
      return undefined
    }
    if (typeof text !== 'string' || text.trim() === '') {
      fail(`${path}.text`, 'A native type needs a "text".')
      return undefined
    }
    return { kind: 'native', dialect: dialect as DialectId, text }
  }
```

`postgres.ts`: in `typeName` add `case 'number': return 'numeric'` and `case 'native': return type.dialect === 'postgres' ? type.text : 'text'`; `generatedClause`: add `case 'number':` to the identity group; `generatedImpliesNotNull`: include `'number'`. In `tableParts`, before the column loop body computes the line: when `column.generated && column.type.kind === 'number'` write the type as `bigint` and push `{ code: 'identity-as-bigint', message: \`${table.name}.${column.name}: PostgreSQL has identity only on integer types, so the generated number was written as bigint.\`, tableId, columnId }`; when the column type, or its array element, is a `native` of another dialect, push `{ code: 'native-type', message: \`${table.name}.${column.name}: ${type.text} is a ${type.dialect} type, so it was written as text.\`, ... }` (`tableParts` must now take `notes` from its context).

`oracle.ts`: `resolveType`: `case 'number': return { sql: 'NUMBER', lob: false }`; `case 'native': return type.dialect === 'oracle' ? { sql: type.text, lob: false } : { sql: 'CLOB', lob: true, note: { code: 'native-type', message: (where) => \`${where}: ${type.text} is a ${type.dialect} type, so it was written as a CLOB.\` } }`; `generatedClause`: add `case 'number':` to the identity group; `generatedImpliesNotNull`: include `'number'`.

Fix every type error the new kinds cause in the core (exhaustive `switch`es); `index.ts` needs no change.

- [ ] **Step 4: Run the whole core suite**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write packages 2>&1 | tail -2; pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/core typecheck 2>&1 | grep -c error; pnpm --filter @forge/web typecheck 2>&1 | grep error | head -5`
Expected: all pass; core typecheck 0 errors. The web typecheck may report exhaustiveness errors for the new kinds: they are fixed in Task 3 (note them in the ledger and go on).

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(core): the types number and native, written by both dialects

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Reading Oracle SQL

**Files:**
- Modify: `packages/core/src/sql/parse/{cursor,tokenize,parse-type,parse-create-table,parse-other,parse-statement,raw,build-schema,import-sql}.ts`
- Create: `packages/core/src/sql/parse/types/postgres.ts` (the current body of `parse-type.ts`, renamed), `packages/core/src/sql/parse/types/oracle.ts`
- Test: `packages/core/src/tests/unit/sql/parse/oracle-type.test.ts`, `oracle-create-table.test.ts`, `packages/core/src/tests/integration/sql/oracle-import.test.ts`, `tokenize-oracle.test.ts` (new); adjust the two named PostgreSQL tests.

**Interfaces:**
- Produces:
  - `tokenize(sql: string, dialect: DialectId = 'postgres')`: in Oracle a line that is only `/` (surrounding spaces allowed) is skipped.
  - `Cursor` constructor gains a fourth parameter `dialect: DialectId = 'postgres'` (a `readonly dialect` field); `identifier()` returns `token.text.toUpperCase()` for an unquoted word when the dialect is Oracle (quoted names unchanged).
  - `parse-type.ts`: `parseColumnType(cursor)` dispatches on `cursor.dialect` to `parsePostgresType(cursor)` (`types/postgres.ts`, the current code) or `parseOracleType(cursor)` (`types/oracle.ts`); both return `{ type: RawType; serial: boolean }`.
  - `parseOracleType` reads the types of the spec's table; a `NUMBER(p[,0])` becomes `smallint` (p ≤ 4), `integer` (≤ 9), `bigint` (≤ 18) or `numeric(p,0)`; `NUMBER(p,s)` with s > 0 `numeric(p,s)`; `NUMBER` and `NUMBER(*,s)` `number`; anything unknown (qualified names too) `{ kind: 'native', dialect: 'oracle', text: <the tokens as written, upper-cased> }` including a parenthesised argument list.
  - PostgreSQL: bare `numeric`/`decimal` is `{ kind: 'number' }` with no warning; a name that is not a defined enum or domain is read as `{ kind: 'native', dialect: 'postgres', text: <name> }` by the builder (no "imported as text" warning).
  - `raw.ts`: `RawColumn.hint?: 'boolean' | 'json'`; `RawTable.hints: { column: string; hint: 'boolean' | 'json' }[]`.
  - Statement parsers: Oracle `GENERATED … [ON NULL] AS IDENTITY`; `DEFAULT [ON NULL] expr`; the words `ENABLE`, `DISABLE`, `VALIDATE`, `NOVALIDATE`, `RELY`, `NORELY` after a constraint are skipped, and `USING INDEX …` is skipped to the end of the element; clauses after the `)` of a `CREATE TABLE` (`TABLESPACE`, `PCTFREE`, …) are one warning and ignored; `CHECK (c IN (0,1))` and `CHECK (c IS JSON [options])` set a hint (column-level or table-level); any other `CHECK` stays the existing warning.
  - `importSql(sql, newId, dialect: DialectId = 'postgres')` threads the dialect to `tokenize`, `Cursor` and `buildSchema`.
  - Builder: applies hints (`boolean` turns smallint/integer/bigint/number/numeric into `boolean`; `json` turns text/varchar/native into `json`); an Oracle `DEFAULT 1`/`0` on a column that became boolean is kept as `true`/`false`; `SYS_GUID()` default on a `uuid` and `SYSTIMESTAMP`/`CURRENT_TIMESTAMP` on a `timestamp` (zone) are generated; identity on `number` is generated.

- [ ] **Step 1: Write the failing tests**

`tokenize-oracle.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { tokenize } from '../../../../sql/parse/tokenize.ts'

describe('tokenize in Oracle', () => {
  it('skips a line that is only a slash, and nothing else', () => {
    const sql = 'CREATE TABLE a (x NUMBER);\n/\nCREATE TABLE b (y NUMBER);\n  /  \n'
    assert.equal(tokenize(sql, 'oracle').tokens.filter((t) => t.value === 'create').length, 2)
    assert.equal(tokenize(sql, 'oracle').tokens.some((t) => t.value === '/'), false)
    // the slash is an operator in PostgreSQL, and a division inside an expression is untouched
    assert.equal(tokenize(sql, 'postgres').tokens.some((t) => t.value === '/'), true)
    assert.equal(tokenize('SELECT a / b', 'oracle').tokens.some((t) => t.value === '/'), true)
  })
})
```

`oracle-type.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Cursor, ParseFailure } from '../../../../sql/parse/cursor.ts'
import { parseColumnType } from '../../../../sql/parse/parse-type.ts'
import { tokenize } from '../../../../sql/parse/tokenize.ts'

function typeOf(sql: string) {
  const warnings: string[] = []
  const cursor = new Cursor(tokenize(sql, 'oracle').tokens, sql, (_l, m) => warnings.push(m), 'oracle')
  const parsed = parseColumnType(cursor)
  return { ...parsed, warnings, rest: cursor.done ? '' : cursor.peek()?.text }
}

describe('Cursor in Oracle: names', () => {
  it('folds a plain word to upper case and keeps a quoted name', () => {
    const sql = 'kontrata_jobs "Mixed" plain'
    const cursor = new Cursor(tokenize(sql, 'oracle').tokens, sql, () => {}, 'oracle')
    assert.deepEqual([cursor.identifier('a'), cursor.identifier('a'), cursor.identifier('a')], ['KONTRATA_JOBS', 'Mixed', 'PLAIN'])
    const pg = new Cursor(tokenize(sql).tokens, sql, () => {})
    assert.equal(pg.identifier('a'), 'kontrata_jobs')
  })
})

describe('parseOracleType', () => {
  const cases: [string, object][] = [
    ['VARCHAR2(255)', { kind: 'varchar', length: 255 }],
    ['VARCHAR2(100 CHAR)', { kind: 'varchar', length: 100 }],
    ['VARCHAR2(100 BYTE)', { kind: 'varchar', length: 100 }],
    ['CHAR(2)', { kind: 'char', length: 2 }],
    ['CLOB', { kind: 'text' }],
    ['BLOB', { kind: 'bytea' }],
    ['RAW(16)', { kind: 'uuid' }],
    ['RAW(8)', { kind: 'bytea' }],
    ['NUMBER', { kind: 'number' }],
    ['NUMBER(*,2)', { kind: 'number' }],
    ['NUMBER(1)', { kind: 'smallint' }],
    ['NUMBER(4)', { kind: 'smallint' }],
    ['NUMBER(5)', { kind: 'integer' }],
    ['NUMBER(9,0)', { kind: 'integer' }],
    ['NUMBER(10)', { kind: 'bigint' }],
    ['NUMBER(18)', { kind: 'bigint' }],
    ['NUMBER(19)', { kind: 'numeric', precision: 19, scale: 0 }],
    ['NUMBER(12,2)', { kind: 'numeric', precision: 12, scale: 2 }],
    ['INTEGER', { kind: 'integer' }],
    ['FLOAT', { kind: 'double' }],
    ['FLOAT(10)', { kind: 'real' }],
    ['BINARY_FLOAT', { kind: 'real' }],
    ['BINARY_DOUBLE', { kind: 'double' }],
    ['DATE', { kind: 'date' }],
    ['TIMESTAMP', { kind: 'timestamp_no_tz' }],
    ['TIMESTAMP(6)', { kind: 'timestamp_no_tz' }],
    ['TIMESTAMP WITH TIME ZONE', { kind: 'timestamp' }],
    ['TIMESTAMP(3) WITH TIME ZONE', { kind: 'timestamp' }],
    ['INTERVAL DAY TO SECOND', { kind: 'interval' }],
    ['INTERVAL DAY(0) TO SECOND(0)', { kind: 'interval' }],
    ['NVARCHAR2(100)', { kind: 'native', dialect: 'oracle', text: 'NVARCHAR2(100)' }],
    ['NCLOB', { kind: 'native', dialect: 'oracle', text: 'NCLOB' }],
    ['ROWID', { kind: 'native', dialect: 'oracle', text: 'ROWID' }],
    ['XMLTYPE', { kind: 'native', dialect: 'oracle', text: 'XMLTYPE' }],
    ['SYS.XMLTYPE', { kind: 'native', dialect: 'oracle', text: 'SYS.XMLTYPE' }],
    ['INTERVAL YEAR TO MONTH', { kind: 'native', dialect: 'oracle', text: 'INTERVAL YEAR TO MONTH' }],
    ['TIMESTAMP WITH LOCAL TIME ZONE', { kind: 'native', dialect: 'oracle', text: 'TIMESTAMP WITH LOCAL TIME ZONE' }],
  ]
  for (const [sql, expected] of cases) {
    it(`reads ${sql}`, () => assert.deepEqual(typeOf(sql).type, expected))
  }

  it('stops after the type, leaving the rest', () => {
    assert.equal(typeOf('NUMBER GENERATED BY DEFAULT').rest, 'GENERATED')
    assert.equal(typeOf('VARCHAR2(20) NOT NULL').rest, 'NOT')
  })

  it('never reads a serial, and fails when there is no type or VARCHAR2 has no length', () => {
    assert.equal(typeOf('NUMBER').serial, false)
    assert.throws(() => typeOf(''), ParseFailure)
    assert.throws(() => typeOf('VARCHAR2'), ParseFailure)
  })
})
```

`oracle-create-table.test.ts` (uses `parseScript` after extending it with an optional dialect: change `parseScript(sql, dialect = 'postgres')` in `tests/helpers/parse-script.ts` to pass it to `tokenize` and to `parseStatement`):

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseScript } from '../../../helpers/parse-script.ts'

const tableOf = (sql: string) => {
  const result = parseScript(sql, 'oracle')
  assert.deepEqual(result.failures, [])
  const table = result.raw.tables[0]
  assert.ok(table)
  return { table, warnings: result.warnings }
}

describe('Oracle CREATE TABLE', () => {
  it('reads the identity, the primary key and unique as they are written in the migrations', () => {
    const { table, warnings } = tableOf(`CREATE TABLE KONTRATA_CANDIDATES (
      ID NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
      EMAIL VARCHAR2(255) NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_KONTRATA_CANDIDATES PRIMARY KEY (ID),
      CONSTRAINT UQ_KONTRATA_CANDIDATES_EMAIL UNIQUE (EMAIL)
    );`)
    assert.equal(table.name, 'KONTRATA_CANDIDATES')
    assert.deepEqual(table.columns.map((c) => [c.name, c.generated, c.notNull]), [
      ['ID', true, false],
      ['EMAIL', false, true],
      ['CREATED_AT', false, true],
    ])
    assert.equal(table.columns[2]?.default, 'SYSTIMESTAMP')
    assert.deepEqual(table.primaryKey, ['ID'])
    assert.deepEqual(table.uniques, [{ name: 'UQ_KONTRATA_CANDIDATES_EMAIL', columns: ['EMAIL'] }])
    assert.deepEqual(warnings, [])
  })

  it('reads foreign keys with ON DELETE CASCADE, and warns about the action', () => {
    const { table, warnings } = tableOf(`CREATE TABLE A (
      ID NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
      JOB_ID NUMBER NOT NULL,
      CONSTRAINT FK_A_JOB FOREIGN KEY (JOB_ID)
        REFERENCES KONTRATA_JOBS (ID) ON DELETE CASCADE
    );`)
    assert.deepEqual(table.foreignKeys, [{ columns: ['JOB_ID'], reference: { table: 'KONTRATA_JOBS', columns: ['ID'], actions: true } }])
    assert.deepEqual(warnings, [])
  })

  it('hints boolean for IN (0,1) and json for IS JSON, at column level and table level', () => {
    const { table, warnings } = tableOf(`CREATE TABLE T (
      A NUMBER(1) DEFAULT 0 NOT NULL CHECK (A IN (0,1)),
      B CLOB NOT NULL CHECK (B IS JSON),
      C NUMBER(1),
      D CLOB,
      E NUMBER(1),
      CONSTRAINT CK_T_C CHECK (C IN (0,1)),
      CONSTRAINT CK_T_D CHECK (D IS JSON STRICT),
      CONSTRAINT CK_T_E CHECK (E IN ('X','Y'))
    );`)
    assert.equal(table.columns[0]?.hint, 'boolean')
    assert.equal(table.columns[1]?.hint, 'json')
    assert.deepEqual(table.hints, [{ column: 'C', hint: 'boolean' }, { column: 'D', hint: 'json' }])
    assert.equal(warnings.length, 1)
    assert.ok(warnings[0]?.includes('CHECK'))
  })

  it('skips ENABLE, VALIDATE and USING INDEX after a constraint', () => {
    const { table, warnings } = tableOf(`CREATE TABLE T (
      ID NUMBER,
      CONSTRAINT PK_T PRIMARY KEY (ID) USING INDEX ENABLE,
      X NUMBER CONSTRAINT NN NOT NULL ENABLE VALIDATE
    );`)
    assert.deepEqual(table.primaryKey, ['ID'])
    assert.equal(table.columns[1]?.notNull, true)
    assert.deepEqual(warnings, [])
  })

  it('warns once about the physical clauses after the closing parenthesis, and keeps the table', () => {
    const { table, warnings } = tableOf('CREATE TABLE T (ID NUMBER) TABLESPACE USERS PCTFREE 10;')
    assert.equal(table.columns.length, 1)
    assert.equal(warnings.length, 1)
  })

  it('reads DEFAULT ON NULL', () => {
    const { table } = tableOf('CREATE TABLE T (X NUMBER DEFAULT ON NULL 5 NOT NULL);')
    assert.equal(table.columns[0]?.default, '5')
  })
})
```

`oracle-import.test.ts` (importSql in Oracle on excerpts of the real migrations; paste the three tables below exactly):

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { importSql } from '../../../sql/parse/import-sql.ts'

let counter = 0
const run = (sql: string, dialect: 'oracle' | 'postgres' = 'oracle') =>
  importSql(sql, () => `id-${++counter}`, dialect)

const SCRIPT = `
-- Store de identidade do CANDIDATO
CREATE TABLE KONTRATA_CANDIDATES (
  ID NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
  NAME VARCHAR2(255),
  EMAIL VARCHAR2(255) NOT NULL,
  EMAIL_VERIFIED_AT TIMESTAMP,
  CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT PK_KONTRATA_CANDIDATES PRIMARY KEY (ID),
  CONSTRAINT UQ_KONTRATA_CANDIDATES_EMAIL UNIQUE (EMAIL)
);

COMMENT ON TABLE KONTRATA_CANDIDATES IS 'Identidade do candidato';
COMMENT ON COLUMN KONTRATA_CANDIDATES.EMAIL_VERIFIED_AT IS 'Instante da confirmacao do email';

CREATE TABLE KONTRATA_JOBS (
  ID                    NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
  TITLE                 VARCHAR2(255)  NOT NULL,
  DESCRIPTION           CLOB,
  ADDRESS_STATE         CHAR(2)        NOT NULL,
  ADDRESS_LATITUDE      NUMBER,
  OPENINGS              NUMBER(4)      DEFAULT 1 NOT NULL,
  SALARY_MIN            NUMBER(12,2),
  PWD_ELIGIBLE          NUMBER(1)      DEFAULT 0 NOT NULL,
  STATUS                VARCHAR2(20)   DEFAULT 'DRAFT' NOT NULL,
  CONFIG                CLOB NOT NULL CHECK (CONFIG IS JSON),
  CONSTRAINT PK_KONTRATA_JOBS PRIMARY KEY (ID),
  CONSTRAINT CK_JOBS_STATUS CHECK (
    STATUS IN ('DRAFT','PUBLISHED','CLOSED')
  ),
  CONSTRAINT CK_JOBS_PWD CHECK (PWD_ELIGIBLE IN (0,1)),
  CONSTRAINT CK_JOBS_OPENINGS CHECK (OPENINGS >= 1)
);

CREATE INDEX IDX_JOBS_STATUS  ON KONTRATA_JOBS (STATUS);
CREATE INDEX IDX_JOBS_CREATED ON KONTRATA_JOBS (CREATED_AT DESC);
CREATE UNIQUE INDEX UQ_JOBS_TITLE ON KONTRATA_JOBS (TITLE);

COMMENT ON COLUMN KONTRATA_JOBS.PWD_ELIGIBLE IS '1 = vaga elegivel para pessoa com deficiencia';

CREATE TABLE KONTRATA_JOB_APPLICATIONS (
  ID               NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
  JOB_ID           NUMBER        NOT NULL,
  CANDIDATE_ID     NUMBER        NOT NULL,
  OUTCOME          VARCHAR2(20),
  CONSTRAINT PK_KONTRATA_JOB_APPLICATIONS PRIMARY KEY (ID),
  CONSTRAINT FK_JOB_APPLICATIONS_JOB FOREIGN KEY (JOB_ID)
    REFERENCES KONTRATA_JOBS (ID) ON DELETE CASCADE,
  CONSTRAINT FK_JOB_APPLICATIONS_CAND FOREIGN KEY (CANDIDATE_ID)
    REFERENCES KONTRATA_CANDIDATES (ID),
  CONSTRAINT UQ_JOB_APPLICATIONS UNIQUE (JOB_ID, CANDIDATE_ID),
  CONSTRAINT CK_JOB_APPL_OUTCOME CHECK (OUTCOME IN ('HIRED', 'REJECTED'))
);
`

describe('importSql in Oracle: the team migrations', () => {
  const result = run(SCRIPT)
  const table = (name: string) => result.schema.tables.find((t) => t.name === name)
  const column = (t: string, c: string) => table(t)?.columns.find((x) => x.name === c)

  it('has no errors, and upper-case names', () => {
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.schema.tables.map((t) => t.name), ['KONTRATA_CANDIDATES', 'KONTRATA_JOBS', 'KONTRATA_JOB_APPLICATIONS'])
  })

  it('reads NUMBER as number, an identity as generated, and the primary keys', () => {
    assert.deepEqual(column('KONTRATA_JOBS', 'ID')?.type, { kind: 'number' })
    assert.equal(column('KONTRATA_JOBS', 'ID')?.generated, true)
    assert.equal(column('KONTRATA_JOBS', 'ADDRESS_LATITUDE')?.type.kind, 'number')
    assert.deepEqual(table('KONTRATA_JOBS')?.primaryKey, [column('KONTRATA_JOBS', 'ID')?.id])
  })

  it('reads the other types, and the checks that make a boolean and a json', () => {
    assert.deepEqual(column('KONTRATA_JOBS', 'TITLE')?.type, { kind: 'varchar', length: 255 })
    assert.deepEqual(column('KONTRATA_JOBS', 'DESCRIPTION')?.type, { kind: 'text' })
    assert.deepEqual(column('KONTRATA_JOBS', 'ADDRESS_STATE')?.type, { kind: 'char', length: 2 })
    assert.deepEqual(column('KONTRATA_JOBS', 'OPENINGS')?.type, { kind: 'smallint' })
    assert.deepEqual(column('KONTRATA_JOBS', 'SALARY_MIN')?.type, { kind: 'numeric', precision: 12, scale: 2 })
    assert.deepEqual(column('KONTRATA_JOBS', 'PWD_ELIGIBLE')?.type, { kind: 'boolean' })
    assert.equal(column('KONTRATA_JOBS', 'PWD_ELIGIBLE')?.default, 'false')
    assert.deepEqual(column('KONTRATA_JOBS', 'CONFIG')?.type, { kind: 'json' })
    assert.deepEqual(column('KONTRATA_CANDIDATES', 'CREATED_AT')?.type, { kind: 'timestamp_no_tz' })
    assert.equal(column('KONTRATA_CANDIDATES', 'CREATED_AT')?.default, 'SYSTIMESTAMP')
    assert.equal(column('KONTRATA_JOBS', 'STATUS')?.default, "'DRAFT'")
    assert.equal(column('KONTRATA_JOBS', 'OPENINGS')?.default, '1')
  })

  it('reads the foreign keys, the unique constraints and indexes, and the comments', () => {
    assert.equal(result.schema.relationships.length, 2)
    const names = table('KONTRATA_JOBS')?.indexes?.map((i) => [i.name, i.unique, i.columns.length])
    assert.deepEqual(names, [['IDX_JOBS_STATUS', false, 1], ['UQ_JOBS_TITLE', true, 1]])
    assert.deepEqual(table('KONTRATA_JOB_APPLICATIONS')?.indexes?.map((i) => i.name), ['UQ_JOB_APPLICATIONS'])
    assert.equal(table('KONTRATA_CANDIDATES')?.comment, 'Identidade do candidato')
    assert.equal(column('KONTRATA_JOBS', 'PWD_ELIGIBLE')?.comment, '1 = vaga elegivel para pessoa com deficiencia')
  })

  it('warns about what it does not model, with the line', () => {
    const text = result.warnings.map((w) => w.message).join('\n')
    for (const fragment of ['ON DELETE', 'CHECK', 'IDX_JOBS_CREATED']) {
      assert.ok(text.includes(fragment), `no warning mentions ${fragment}: ${text}`)
    }
    assert.ok(result.warnings.every((w) => w.line >= 1))
  })

  it('reads the same script as PostgreSQL very differently, and never as Oracle by accident', () => {
    const pg = run('CREATE TABLE a (id NUMBER)', 'postgres')
    assert.equal(pg.schema.tables[0]?.columns[0]?.type.kind, 'native')
  })
})

describe('importSql: native and number, in PostgreSQL', () => {
  it('reads bare numeric as number, and an unknown type as a native type', () => {
    const result = run('CREATE TABLE t (a numeric, b decimal, c inet, d money[])', 'postgres')
    assert.deepEqual(result.warnings, [])
    const types = result.schema.tables[0]?.columns.map((c) => c.type)
    assert.deepEqual(types, [
      { kind: 'number' },
      { kind: 'number' },
      { kind: 'native', dialect: 'postgres', text: 'inet' },
      { kind: 'array', of: { kind: 'native', dialect: 'postgres', text: 'money' } },
    ])
  })

  it('still resolves a type the script defines', () => {
    const result = run("CREATE TYPE mood AS ENUM ('a'); CREATE TABLE t (m mood, n inet);", 'postgres')
    assert.equal(result.schema.tables[0]?.columns[0]?.type.kind, 'user')
    assert.equal(result.schema.tables[0]?.columns[1]?.type.kind, 'native')
  })
})

describe('the Oracle script Forge writes reads back', () => {
  it('gives the same schema, apart from ids', async () => {
    const { generateDdl } = await import('../../../sql/generate/generate-ddl.ts')
    const { oracle } = await import('../../../dialects/oracle.ts')
    const first = run(SCRIPT)
    const ddl = generateDdl(first.schema, oracle())
    assert.equal(ddl.ok, true)
    if (!ddl.ok) return
    const second = run(ddl.sql)
    assert.deepEqual(second.errors, [])
    const shape = (s: typeof first.schema) =>
      s.tables.map((t) => ({
        name: t.name,
        columns: t.columns.map((c) => [c.name, c.type, c.nullable || t.primaryKey.includes(c.id), c.generated ?? false]),
        indexes: (t.indexes ?? []).map((i) => [i.name, i.unique, i.columns.length]),
        comment: t.comment ?? null,
      }))
    assert.deepEqual(shape(second.schema), shape(first.schema))
    assert.equal(second.schema.relationships.length, first.schema.relationships.length)
  })
})
```

In the round-trip test, `c.nullable || t.primaryKey.includes(c.id)` is a normalisation (a primary-key column is `NOT NULL` whether or not the model says so). If a difference remains, find out whether the writer or the reader is wrong and fix **that**; do not weaken the comparison without a ledgered ruling.

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/sql/parse/oracle-type.test.ts src/tests/unit/sql/parse/oracle-create-table.test.ts src/tests/unit/sql/parse/tokenize-oracle.test.ts src/tests/integration/sql/oracle-import.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL.

- [ ] **Step 3: Implement the reader**

1. `git mv packages/core/src/sql/parse/parse-type.ts packages/core/src/sql/parse/types/postgres.ts` and rename its export to `parsePostgresType`; in it, bare `numeric`/`decimal` becomes `{ kind: 'number' }` (delete the `numeric without a precision` warning and the 38/10 default). Create `packages/core/src/sql/parse/parse-type.ts`:

```ts
import type { Cursor } from './cursor.ts'
import type { RawType } from './raw.ts'
import { parseOracleType } from './types/oracle.ts'
import { parsePostgresType } from './types/postgres.ts'

/** Reads a column type the way the script's database writes it. */
export function parseColumnType(cursor: Cursor): { type: RawType; serial: boolean } {
  return cursor.dialect === 'oracle'
    ? parseOracleType(cursor)
    : parsePostgresType(cursor)
}
```

   Update the imports of the moved file (`../cursor.ts`, `../raw.ts`) and the existing unit test imports (`parse-type.test.ts` keeps importing `parseColumnType` from `parse-type.ts`; change its bare-numeric test to expect `{ kind: 'number' }` with no warning).

2. `types/oracle.ts`:

```ts
import { MAX_NUMERIC_PRECISION, MAX_VARCHAR_LENGTH } from '../../../schema/types.ts'
import type { Cursor } from '../cursor.ts'
import type { RawType } from '../raw.ts'

const native = (text: string): RawType => ({ kind: 'native', dialect: 'oracle', text })

/** `(n)` or `(n, m)`; `*` stands for "no precision" and reads as NaN. */
function readArgs(cursor: Cursor): (number | null)[] {
  if (!cursor.acceptSymbol('(')) return []
  const args: (number | null)[] = []
  do {
    const token = cursor.next()
    if (token.kind === 'symbol' && token.value === '*') args.push(null)
    else if (token.kind === 'number' && /^\d+$/.test(token.value)) args.push(Number(token.value))
    else if (token.kind === 'symbol' && token.value === '-') {
      const next = cursor.next()
      args.push(-Number(next.value))
    } else cursor.fail('Expected a whole number in the type.')
  } while (cursor.acceptSymbol(','))
  cursor.expectSymbol(')')
  return args
}

/** A length, with the optional BYTE or CHAR that follows it. */
function readLength(cursor: Cursor, what: string): number {
  cursor.expectSymbol('(')
  const token = cursor.next()
  if (token.kind !== 'number' || !/^\d+$/.test(token.value)) cursor.fail('Expected a whole number in the type.')
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

function whole(precision: number): RawType {
  if (precision <= 4) return { kind: 'smallint' }
  if (precision <= 9) return { kind: 'integer' }
  if (precision <= 18) return { kind: 'bigint' }
  return { kind: 'numeric', precision, scale: 0 }
}

export function parseOracleType(cursor: Cursor): { type: RawType; serial: boolean } {
  const first = cursor.peek()
  if (first?.kind !== 'word' && first?.kind !== 'ident') return cursor.fail('Expected a column type.')
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
  if (word === 'clob') { cursor.next(); return done({ kind: 'text' }) }
  if (word === 'blob') { cursor.next(); return done({ kind: 'bytea' }) }
  if (word === 'raw') {
    cursor.next()
    const [size] = readArgs(cursor)
    return done(size === 16 ? { kind: 'uuid' } : { kind: 'bytea' })
  }
  if (word === 'number' || word === 'decimal' || word === 'numeric') {
    cursor.next()
    const [precision, scale] = readArgs(cursor)
    if (precision === undefined || precision === null) return done({ kind: 'number' })
    if (precision > MAX_NUMERIC_PRECISION) return done({ kind: 'number' })
    if (scale === undefined || scale === 0) return done(whole(precision))
    if (scale === null || scale < 0) return done({ kind: 'number' })
    return done({ kind: 'numeric', precision, scale: Math.min(scale, precision) })
  }
  if (word === 'integer' || word === 'int') { cursor.next(); return done({ kind: 'integer' }) }
  if (word === 'smallint') { cursor.next(); return done({ kind: 'smallint' }) }
  if (word === 'float') {
    cursor.next()
    const [precision] = readArgs(cursor)
    return done(typeof precision === 'number' && precision <= 24 ? { kind: 'real' } : { kind: 'double' })
  }
  if (word === 'binary_float' || word === 'real') { cursor.next(); return done({ kind: 'real' }) }
  if (word === 'binary_double') { cursor.next(); return done({ kind: 'double' }) }
  if (word === 'double') { cursor.next(); cursor.expectWord('precision'); return done({ kind: 'double' }) }
  if (word === 'date') { cursor.next(); return done({ kind: 'date' }) }
  if (word === 'timestamp') {
    cursor.next()
    readArgs(cursor)
    if (cursor.acceptWords('with', 'local', 'time', 'zone')) return done(native('TIMESTAMP WITH LOCAL TIME ZONE'))
    if (cursor.acceptWords('with', 'time', 'zone')) return done({ kind: 'timestamp' })
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
  return done(native(cursor.slice(start, cursor.pos).replace(/\s+/g, ' ').toUpperCase()))
}
```

3. `cursor.ts`: import `DialectId`; add the fourth constructor parameter and `readonly dialect: DialectId`; `identifier()` returns `token.kind === 'word' && this.dialect === 'oracle' ? token.text.toUpperCase() : token.value`.
4. `tokenize.ts`: `tokenize(sql, dialect: DialectId = 'postgres')`; at the whitespace/line handling, when `dialect === 'oracle'` and the current line (from the last newline to the next) is only `/` (trimmed), skip the whole line like a comment line.
5. `raw.ts`: add `hint?: 'boolean' | 'json'` to `RawColumn` and `hints: { column: string; hint: 'boolean' | 'json' }[]` to `RawTable`; `parseCreateTable` creates tables with `hints: []`.
6. `parse-create-table.ts`: (a) `parseGenerated`: before `cursor.expectWord('as')` add `cursor.acceptWords('on', 'null')`; (b) `parseColumn`: after `acceptWord('default')` add `cursor.acceptWords('on', 'null')` (Oracle `DEFAULT ON NULL`); in the constraint loop add, before the final `else`, `else if (cursor.acceptWord('enable', 'disable', 'validate', 'novalidate', 'rely', 'norely')) { }` and `else if (cursor.acceptWords('using', 'index')) { skipElement(cursor) }`; (c) `check` in a column: when `cursor.dialect === 'oracle'`, call `readCheckHint(cursor)`; a hint for this column sets `column.hint`, otherwise keep the existing `skipBalanced` + warning (the hint reader restores the position when it does not match); (d) `parseTableConstraint` `check`: the same, pushing `table.hints.push(...)` when the hint's column exists in `table.columns` or later (store by name); (e) add `'enable'`, `'disable'`, `'validate'`, `'novalidate'`, `'using'` to `EXPRESSION_STOPS`; (f) at the end of `parseCreateTable`, when `cursor.dialect === 'oracle' && !cursor.done`, `cursor.warn(\`Physical clauses of "${name}" (tablespace, storage…) are not modelled and were ignored.\`)`. Add the exported helper:

```ts
/**
 * At `CHECK (`: reads `col IN (0,1)` as a boolean hint and `col IS JSON [...]`
 * as a json hint. Anything else leaves the position after the whole `( … )`.
 */
export function readCheckHint(cursor: Cursor): { column: string; hint: 'boolean' | 'json' } | null {
  const start = cursor.pos
  cursor.expectSymbol('(')
  const token = cursor.peek()
  if (token?.kind === 'word' || token?.kind === 'ident') {
    const column = cursor.identifier('a column name')
    if (cursor.acceptWords('is', 'json')) {
      while (!cursor.done && !cursor.isSymbol(')')) cursor.next()
      if (cursor.acceptSymbol(')')) return { column, hint: 'json' }
    } else if (cursor.acceptWord('in') && cursor.acceptSymbol('(')) {
      const a = cursor.next()
      if (cursor.acceptSymbol(',')) {
        const b = cursor.next()
        const zeroOne = [a.value, b.value].sort().join(',') === '0,1'
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
```

7. `parse-statement.ts`: `parseStatement(statement, sql, raw, warn, preview, dialect: DialectId = 'postgres')` passes `dialect` to `new Cursor(...)`; for Oracle the "ignored" label works as is (`CREATE SEQUENCE`, `CREATE TRIGGER`, `INSERT INTO`).
8. `build-schema.ts`: `buildSchema(raw, newId, warn, dialect: DialectId = 'postgres')`. (a) the `named` branch of `resolveType`: an unknown name returns `{ kind: 'native', dialect, text: type.name }` (no warning; the name is kept as the script wrote it); (b) in the table loop, index `rawTable.hints` by column name, and after `resolveType` apply `const hint = column.hint ?? hintsByColumn.get(column.name)`: `boolean` turns `smallint | integer | bigint | number | numeric` into `{ kind: 'boolean' }`, `json` turns `text | varchar | native` into `{ kind: 'json' }`; (c) in `interpret`, for Oracle: `SYS_GUID()` on `uuid` and `SYSTIMESTAMP`/`CURRENT_TIMESTAMP[(n)]` on `timestamp` are generated; (d) a column that became boolean with a default `1`/`0` gets `true`/`false`.
9. `import-sql.ts`: `importSql(sql, newId, dialect: DialectId = 'postgres')`; `tokenize(sql, dialect)`, `parseStatement(..., preview, dialect)`, `buildSchema(raw, newId, warn, dialect)`.
10. Update the two named PostgreSQL tests in `import-sql.test.ts` (unknown type is `native`, no warning) and run the suite: every other PostgreSQL test must pass unchanged.

- [ ] **Step 4: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write packages 2>&1 | tail -2; pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/core typecheck 2>&1 | grep -c error`
Expected: all pass, 0 type errors. For each failure, find the cause (systematic debugging) and fix the reader, not the test, unless the test contradicts the spec's table.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(core): read Oracle SQL: its types, identity, checks and upper-case names

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The web: the new types, and "Read as"

**Files:**
- Modify: `apps/web/src/lib/column-types.ts`, `apps/web/src/components/inspector/inspector.tsx`, `apps/web/src/components/import/import-dialog.tsx`, and every file the new `ColumnType` kinds make the compiler flag (canvas node, types panel, `generated.ts` if needed)
- Test: `apps/web/src/tests/unit/lib/column-types-native.test.ts` (new); adjust existing tests only where `COLUMN_KINDS` or formatting changes

**Interfaces:**
- Produces: `COLUMN_KINDS` includes `number` (label `number (any precision)`); `formatColumnType` writes a native as its text and a `number` as `number`; the Inspector's type select shows `number`; a `native` column shows an extra disabled option `native: <text>` and a text field `aria-label='Native type'` that edits the text; the import dialog has `Read as` (`aria-label='Read as'`, PostgreSQL | Oracle, set to the project's dialect when it opens), calls `importSql(text, newId, readAs)` and no longer shows the "Scripts are read as PostgreSQL" note (it says `Scripts are read as <PostgreSQL|Oracle>.` instead); changing `Read as` re-reads the text.

- [ ] **Step 1: Write the failing tests**

`column-types-native.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { COLUMN_KINDS, defaultColumnType, formatColumnType, kindLabel } from '../../../lib/column-types.ts'

describe('number and native in the web helpers', () => {
  it('number is a kind with its own label and default', () => {
    assert.ok((COLUMN_KINDS as readonly string[]).includes('number'))
    assert.equal(kindLabel('number'), 'number (any precision)')
    assert.deepEqual(defaultColumnType('number'), { kind: 'number' })
  })

  it('formats number, a native by its text, and an array of either', () => {
    assert.equal(formatColumnType({ kind: 'number' }), 'number')
    assert.equal(formatColumnType({ kind: 'native', dialect: 'oracle', text: 'NVARCHAR2(100)' }), 'NVARCHAR2(100)')
    assert.equal(formatColumnType({ kind: 'array', of: { kind: 'native', dialect: 'postgres', text: 'inet' } }), 'inet[]')
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/web && node --test src/tests/unit/lib/column-types-native.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL. Then: in `column-types.ts` add `number: 'number (any precision)'` to `KIND_LABELS`, a `case 'native': return type.text` in `formatColumnType`, make `defaultColumnType`/`COLUMN_KINDS` carry `number` (automatic through `SIMPLE_COLUMN_KINDS`); `choiceOf` returns `'native'` for a native; in `inspector.tsx` add, when the column type (or its element) is a native, an extra `<option value='native' disabled>native: {text}</option>` in the type select and an `<input aria-label='Native type' value={text} onChange={...updateColumn(... type: { ...native, text })}>`; fix every type error `pnpm --filter @forge/web typecheck` reports. In `import-dialog.tsx`: `const projectDialect = useForgeStore((state) => state.dialect)`; `const [readAs, setReadAs] = useState<DialectId>(projectDialect)`; a `<label className='field'>Read as <select aria-label='Read as' ...></select></label>` above the text area; `parse(text, readAs)` calls `importSql(text, () => crypto.randomUUID(), readAs)`; on a change of `readAs`, set it and re-read the current text with `parse(text, next)` immediately (not debounced); replace the PostgreSQL note by `Scripts are read as {label}.`.

- [ ] **Step 3: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write apps 2>&1 | tail -2; pnpm typecheck 2>&1 | grep -ci error; pnpm --filter @forge/web test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; cd apps/e2e && pnpm exec playwright test --workers=3 --reporter=line 2>&1 | grep -E "passed|failed|^\s+\[chromium\]"`
Expected: 0 type errors, unit tests pass, the existing e2e suite passes. The existing e2e that expects the PostgreSQL note in the import dialog (`oracle-dialect.spec.ts`, 'the import dialog says scripts are read as PostgreSQL') changes to the new text: `Scripts are read as Oracle.` under an Oracle project and `Scripts are read as PostgreSQL.` under a PostgreSQL one.

- [ ] **Step 4: Commit**

```bash
git add apps
git commit -m "feat(web): the number and native types, and Read as in the import dialog

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The recruitment example

**Files:**
- Create: `apps/web/src/lib/example/recruitment-sql.ts` (generated), `apps/web/src/lib/example/recruitment-example.ts`, `scripts/build-recruitment-example.mjs` (the generator, kept so the copy can be refreshed)
- Modify: `apps/web/src/lib/store/forge-store.ts` (`loadExample(name)`), `apps/web/src/components/toolbar/toolbar.tsx`, `apps/web/src/styles.css` if needed
- Test: `apps/web/src/tests/unit/lib/example/recruitment-example.test.ts` (new)

**Interfaces:**
- Produces: `RECRUITMENT_SQL: string` (the 57 DDL migrations `0001`…`0058`, in order, joined with a blank line, no `seeds/`); `createRecruitmentExample(): { schema: Schema; view: ProjectView; warnings: ImportMessage[] }` (reads `RECRUITMENT_SQL` with `importSql(sql, counterId, 'oracle')`, throws if there are errors, lays out with `layoutTables`, ids `rc-1`, `rc-2`, … so it is deterministic); `ForgeState.loadExample(name?: 'shop' | 'recruitment')` (default `'shop'`; `recruitment` also sets `dialect: 'oracle'` and `dialectOptions: {}`); toolbar button `Load recruitment example` (armed text `Replace the project with the recruitment example?` when the project has content), placed after `Load example`.

- [ ] **Step 1: Generate the bundled SQL**

`scripts/build-recruitment-example.mjs`:

```js
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.argv[2]
const OUT = new URL('../apps/web/src/lib/example/recruitment-sql.ts', import.meta.url)
if (!DIR) throw new Error('Usage: node scripts/build-recruitment-example.mjs <migrations dir>')

const files = readdirSync(DIR).filter((name) => /^00\d\d_.*\.sql$/.test(name)).sort()
const sql = files.map((name) => readFileSync(join(DIR, name), 'utf8').trimEnd()).join('\n\n')
const header = `// Generated by scripts/build-recruitment-example.mjs from ${files.length} DDL migrations of the\n// recruitment system (Oracle). Do not edit by hand.\n`
writeFileSync(OUT, `${header}export const RECRUITMENT_SQL = ${JSON.stringify(sql)}\n`)
console.log(`${files.length} files, ${sql.length} characters`)
```

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && node scripts/build-recruitment-example.mjs /home/cristian.giehl@koch.intranet/Projetos/sistema-recrutamento-selecao/apps/api/src/infra/database/oracle/migrations`
Expected: `57 files, ~100000 characters`. Count the `CREATE TABLE` statements of the generated text (`grep -o "CREATE TABLE" … | wc -l`) and note it as N for the tests below.

- [ ] **Step 2: Write the failing tests**

`recruitment-example.test.ts` (replace `N` with the number from step 1 and `R` with the number of `REFERENCES` in the text, both measured, not guessed):

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { generateDdl, oracle, validate } from '@forge/core'

import { createRecruitmentExample } from '../../../../lib/example/recruitment-example.ts'
import { RECRUITMENT_SQL } from '../../../../lib/example/recruitment-sql.ts'
import { routeRelationships } from '../../../../lib/routing/route-relationships.ts'
import { resolvePositions } from '../../../../lib/canvas/to-flow.ts'

const N = 0 // tables in RECRUITMENT_SQL
const R = 0 // REFERENCES in RECRUITMENT_SQL

describe('the recruitment example', () => {
  const example = createRecruitmentExample()

  it('reads every table and has no problem with the schema', () => {
    assert.equal(example.schema.tables.length, N)
    assert.deepEqual(validate(example.schema), [])
    assert.ok(example.schema.tables.every((t) => t.name === t.name.toUpperCase()))
  })

  it('keeps the foreign keys Forge can model, and says what it left out', () => {
    assert.ok(example.schema.relationships.length > 0)
    assert.ok(example.schema.relationships.length <= R)
    assert.ok(example.warnings.every((w) => w.line >= 1))
  })

  it('is laid out, with a position for every table and parents to the left', () => {
    assert.equal(Object.keys(example.view.nodes).length, N)
    for (const relationship of example.schema.relationships.slice(0, 20)) {
      const parent = example.view.nodes[relationship.to.tableId]
      const child = example.view.nodes[relationship.from.tableId]
      if (relationship.to.tableId !== relationship.from.tableId) assert.ok((parent?.x ?? 0) <= (child?.x ?? 0))
    }
  })

  it('is deterministic', () => {
    assert.deepEqual(createRecruitmentExample().schema, example.schema)
  })

  it('writes an Oracle script that reads back to the same number of tables and keys', () => {
    const ddl = generateDdl(example.schema, oracle())
    assert.equal(ddl.ok, true, ddl.ok ? '' : JSON.stringify(ddl.issues.slice(0, 3)))
  })

  it('routes every line in a reasonable time', () => {
    const started = Date.now()
    const routes = routeRelationships(example.schema, resolvePositions(example.schema, example.view))
    assert.equal(routes.size, example.schema.relationships.length)
    assert.ok(Date.now() - started < 5000, `routing took ${Date.now() - started} ms`)
  })

  it('is bundled as the SQL it was read from', () => {
    assert.ok(RECRUITMENT_SQL.includes('CREATE TABLE KONTRATA_JOBS'))
  })
})
```

If `generateDdl` for Oracle is blocked by an issue (for instance an index whose name collides with a constraint, or a key over a CLOB), that is a **finding about the dialect or the reader**: investigate and fix it there (ledger the cause), do not remove the test.

- [ ] **Step 3: Run to verify it fails; implement**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/web && node --test src/tests/unit/lib/example/recruitment-example.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE" | head -3`
Expected: FAIL (`ERR_MODULE_NOT_FOUND`).

`recruitment-example.ts`:

```ts
import type { ImportMessage, Schema } from '@forge/core'
import { importSql } from '@forge/core'

import { layoutTables } from '../layout/layout-tables.ts'
import type { ProjectView } from '../project-view.ts'
import { createView } from '../project-view.ts'
import { RECRUITMENT_SQL } from './recruitment-sql.ts'

/**
 * The recruitment system's schema, read from its Oracle migrations by the same
 * importer a user would use. Ids are a counter, so it is the same every time.
 */
export function createRecruitmentExample(): {
  schema: Schema
  view: ProjectView
  warnings: ImportMessage[]
} {
  let counter = 0
  const result = importSql(RECRUITMENT_SQL, () => `rc-${++counter}`, 'oracle')
  if (result.errors.length > 0) {
    throw new Error(`The recruitment example does not read: ${result.errors[0]?.message}`)
  }
  return {
    schema: result.schema,
    view: { ...createView(), nodes: layoutTables(result.schema) },
    warnings: result.warnings,
  }
}
```

Store: change `loadExample: () => void` to `loadExample: (name?: 'shop' | 'recruitment') => void` and its body to pick `createShopExample()` or `createRecruitmentExample()`; for `recruitment` the `editProject({...})` also includes `dialect: 'oracle'` and `dialectOptions: {}`. Toolbar: a second button/ConfirmButton pair like the first, labelled `Load recruitment example` with armed label `Replace the project with the recruitment example?`, calling `loadExample('recruitment')`.

- [ ] **Step 4: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write apps scripts 2>&1 | tail -2; pnpm typecheck 2>&1 | grep -ci error; pnpm --filter @forge/web test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"`
Expected: pass. Read the example's warnings once (print them in a throwaway script) and put the **kinds** of warning in the ledger: each must be explainable (ON DELETE actions, CHECKs that are not boolean or json, `DESC` indexes), not a symptom of a reader bug. Any warning that reveals a reader gap (an unread type, a statement it should understand) is fixed in the reader with a test in Task 2's files.

- [ ] **Step 5: Commit**

```bash
git add -A apps scripts
git commit -m "feat(web): the recruitment system as an example, read from its Oracle migrations

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: e2e, docs and the gate

**Files:**
- Create: `apps/e2e/tests/oracle-import.spec.ts`, `docs/adr/0011-types-per-database.md`
- Modify: `apps/web/GLOSSARY.md`, `packages/core/GLOSSARY.md`

- [ ] **Step 1: Write the e2e spec**

```ts
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { Editor } from '../support/editor.ts'

const SCRIPT = `CREATE TABLE KONTRATA_JOBS (
  ID NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
  TITLE VARCHAR2(255) NOT NULL,
  LATITUDE NUMBER,
  ACTIVE NUMBER(1) DEFAULT 1 NOT NULL,
  PAYLOAD CLOB CHECK (PAYLOAD IS JSON),
  RAW_XML XMLTYPE,
  CONSTRAINT PK_KONTRATA_JOBS PRIMARY KEY (ID),
  CONSTRAINT CK_JOBS_ACTIVE CHECK (ACTIVE IN (0,1))
);
CREATE TABLE KONTRATA_APPLICATIONS (
  ID NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
  JOB_ID NUMBER NOT NULL,
  CONSTRAINT PK_KONTRATA_APPLICATIONS PRIMARY KEY (ID),
  CONSTRAINT FK_APPLICATIONS_JOB FOREIGN KEY (JOB_ID) REFERENCES KONTRATA_JOBS (ID) ON DELETE CASCADE
);
`

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Import SQL' })

async function start(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 })
  const editor = new Editor(page)
  await editor.open()
  return editor
}

test.describe('reading Oracle SQL', () => {
  test('Read as starts at the project dialect and an Oracle script imports, with upper-case names', async ({ page }) => {
    const editor = await start(page)
    await page.getByLabel('Dialect').selectOption('oracle')
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await expect(dialog(page).getByLabel('Read as')).toHaveValue('oracle')
    await dialog(page).getByLabel('SQL', { exact: true }).fill(SCRIPT)
    await expect(dialog(page).getByRole('region', { name: 'Import preview' })).toContainText('2 tables')
    await dialog(page).getByRole('button', { name: 'Import', exact: true }).click()

    await expect(editor.tables()).toHaveCount(2)
    await expect(editor.node('KONTRATA_JOBS')).toBeVisible()
    await expect(editor.edges()).toHaveCount(1)
    await expect(editor.node('KONTRATA_JOBS')).toContainText('number')
    await expect(editor.node('KONTRATA_JOBS')).toContainText('boolean')
    await expect(editor.node('KONTRATA_JOBS')).toContainText('json')
    await expect(editor.node('KONTRATA_JOBS')).toContainText('XMLTYPE')
  })

  test('the Oracle script written back has the same shape', async ({ page }) => {
    const editor = await start(page)
    await page.getByLabel('Dialect').selectOption('oracle')
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await dialog(page).getByLabel('SQL', { exact: true }).fill(SCRIPT)
    await dialog(page).getByRole('button', { name: 'Import', exact: true }).click()
    const sql = await editor.ddl()
    expect(sql).toContain('CREATE TABLE KONTRATA_JOBS (')
    expect(sql).toContain('ID NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY')
    expect(sql).toContain('LATITUDE NUMBER,')
    expect(sql).toContain('ACTIVE NUMBER(1) DEFAULT 1 NOT NULL')
    expect(sql).toContain('RAW_XML XMLTYPE')
    expect(sql).toContain('CONSTRAINT PK_KONTRATA_JOBS PRIMARY KEY (ID)')
  })

  test('the same script read as PostgreSQL does not understand the Oracle types, and says so by keeping them native', async ({ page }) => {
    await start(page)
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await dialog(page).getByLabel('Read as').selectOption('oracle')
    await dialog(page).getByLabel('SQL', { exact: true }).fill(SCRIPT)
    await expect(dialog(page).getByRole('region', { name: 'Import preview' })).toContainText('2 tables')
    await dialog(page).getByLabel('Read as').selectOption('postgres')
    await expect(dialog(page).getByRole('region', { name: 'Import preview' })).toContainText('table')
  })

  test('number and native types show in the Inspector', async ({ page }) => {
    const editor = await start(page)
    await page.getByLabel('Dialect').selectOption('oracle')
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await dialog(page).getByLabel('SQL', { exact: true }).fill(SCRIPT)
    await dialog(page).getByRole('button', { name: 'Import', exact: true }).click()
    await editor.selectTable('KONTRATA_JOBS')
    await expect(page.getByLabel('Native type')).toHaveValue('XMLTYPE')
    await expect(page.getByRole('combobox', { name: 'Column type' }).nth(2)).toHaveValue('number')
  })

  test('the recruitment example loads, switches the project to Oracle and shows its tables', async ({ page }) => {
    const editor = await start(page)
    await page.getByRole('button', { name: 'Load recruitment example' }).click()
    await expect(page.getByLabel('Dialect')).toHaveValue('oracle')
    await expect(editor.node('KONTRATA_JOBS')).toBeVisible()
    expect(await editor.tables().count()).toBeGreaterThan(40)
    await editor.showDdl()
    await expect(page.getByText('Fix these problems to generate the DDL')).toHaveCount(0)
    expect(await editor.ddl()).toContain('CREATE TABLE KONTRATA_JOBS (')
  })

  test('loading the recruitment example into a project that has tables asks for a second click, and can be undone', async ({ page }) => {
    const editor = await start(page)
    await editor.addTable('mine')
    await page.getByRole('button', { name: 'Load recruitment example' }).click()
    await expect(editor.node('mine')).toBeVisible()
    await page.getByRole('button', { name: 'Replace the project with the recruitment example?' }).click()
    await expect(editor.node('KONTRATA_JOBS')).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(editor.node('mine')).toBeVisible()
    await expect(editor.tables()).toHaveCount(1)
  })
})
```

If a locator does not resolve, fix the locator; if a behaviour is wrong, fix the code.

- [ ] **Step 2: Run the e2e, iterate until green**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/e2e && pnpm exec biome check --write . 2>&1 | tail -1; pnpm exec playwright test tests/oracle-import.spec.ts --workers=3 --reporter=line 2>&1 | grep -vE "attachment|────|^\s*$|test-results|Usage|show-trace" | head -50`
Expected: all pass after fixing any real defect. Then take a screenshot of the recruitment example loaded, look at it (layout readable? tables overlapping? lines crossing tables?), and note what you see in the ledger.

- [ ] **Step 3: Docs**

`docs/adr/0011-types-per-database.md`: status accepted; context (the types are the core of the project: the engine must know each database's types, in both directions); decision: the logical types plus `number` and `native`; a dialect owns writing (`typeName`/`resolveType`) and reading (`parse/types/<dialect>.ts`); name folding is the dialect's rule (lower for PostgreSQL, upper for Oracle) so Oracle names stay upper case; `CHECK` hints refine types (`IN (0,1)` boolean, `IS JSON` json) and nothing else is inferred; unknown types are kept `native` (and written as a safe type with a note in another database); identity on `number` is written `bigint` in PostgreSQL with a note; the recruitment example is read by the importer from a generated copy of the migrations. Rejected: reading `NUMBER` as a guessed `bigint`/`numeric` (wrong for latitudes), inferring enums from `IN ('A','B')`. Consequences: a new database is a writer module plus a type reader; `native` data does not travel between databases; PL/SQL is not read.

`packages/core/GLOSSARY.md`: **Number** (a number with no precision: `NUMBER` in Oracle, `numeric` in PostgreSQL), **Native type** (a column type the model has no logical type for, kept as the database writes it, with the database it belongs to; written as a safe type, with a note, in another database), **Type reader** (the per-database module that turns the SQL spelling of a type into a model type; the writer is the dialect's `typeName`). `apps/web/GLOSSARY.md`: **Read as** (the import dialog's choice of the script's database; starts at the project's dialect) and **Recruitment example** (the second example: the recruitment system's Oracle migrations, read by the importer; loading it makes the project Oracle).

- [ ] **Step 4: Final gate**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint && pnpm typecheck && pnpm test 2>&1 | grep -E "ℹ (tests|pass|fail)" && pnpm build 2>&1 | tail -1 && (cd apps/e2e && pnpm exec playwright test --workers=3 --reporter=line 2>&1 | grep -E "passed|failed")`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A apps docs packages scripts
git commit -m "test(e2e): reading Oracle SQL and the recruitment example; ADR and glossary

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
