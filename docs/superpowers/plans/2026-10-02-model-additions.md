# Model additions (sub-project 1 of SQL import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the model able to hold indexes, comments, raw `DEFAULT` expressions, more column types (arrays, user enums and domains), generate their DDL, and edit and show them in the app, so the later SQL parser has somewhere to put everything it reads.

**Architecture:** New data is optional on the existing immutable types (absent means empty), so every saved project and every existing test literal stays valid. Core gets types, validation, pure operations, project parsing and DDL generation; web gets store actions, Inspector sections and a comment icon with a hover tooltip on the canvas. Node geometry does not change.

**Tech Stack:** TypeScript 7, `node:test` with type stripping, React 19 (React Compiler: no `useMemo`/`useCallback`/`memo`), Zustand vanilla store, `@xyflow/react` 12, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-02-sql-import-design.md` (section 1, "Model", plus the Inspector and canvas parts). This plan covers sub-project 1 only; the parser and the import dialog get their own plans.

## Global Constraints

- Run Node through mise: prefix every command with `export PATH="$(mise where node)/bin:$PATH"`. Use absolute paths; a wrong cwd gives empty test output.
- Tests live in `src/tests/unit/**` and `src/tests/integration/**` of each package (never colocated). Core test command: `pnpm --filter @forge/core test`. Web: `pnpm --filter @forge/web test`. e2e: `pnpm e2e`. Whole gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`.
- Biome style: single quotes, no semicolons, 2-space indent, width 80, imports organised (run `pnpm lint:fix`). A comment inside `biome.json` silently breaks it: never add one.
- The core is platform-free (no DOM, no Node APIs, no dependencies). Data is immutable; operations are pure and return the same `Schema` object when nothing applies.
- React Compiler is on: no `useMemo`, `useCallback` or `memo`.
- PostgreSQL only. The logical `timestamp` stays `timestamptz`; the logical `json` stays `jsonb`.
- Node geometry is fixed (width 220, title 31, row 26, border 1): nothing in this plan may change a node's size.
- `formatVersion` stays 1. New schema fields are optional (`indexes?`, `types?`, `comment?`, `default?`); an empty string for `comment` or `default` means "none" everywhere (generator, UI).
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.

## Rulings made while planning

- **Optional fields, not required ones.** The spec says "optional or default to empty"; `Table.indexes?` and `Schema.types?` are optional in the type (as `Column.generated?` already is). Making them required would break every `Table` and `Schema` literal in the existing tests.
- **No `jsonb` kind.** The logical `json` already maps to `jsonb`; the parser (later) will read both `json` and `jsonb` as `json`. The spec's `jsonb` entry is dropped.
- **`timestamp` without time zone is the kind `timestamp_no_tz`**, so the existing `timestamp` (an instant, `timestamptz`) is unchanged.
- **`DdlStatement` gains three kinds** (`type`, `index`, `comment`); only `type` has no `tableId`. Web code that reads `statement.tableId` must narrow.
- **Relationship type check** compares the shape of the types (`array` element and `user` type id included), not only `kind`, so `status_enum` can reference `status_enum` but not another enum.

## Review Focus

Failure modes the spec implies that no single task's happy path exercises (each has a test in the owning task):

1. A project saved before this change (no `indexes`, no `types`, no comments) loads, validates, generates the same DDL and saves back without new keys (Task 3, Task 4).
2. Removing a column that an index uses shrinks the index, and drops it when it was the only column; removing a table removes its indexes with it (Task 2).
3. A user type that is in use cannot be removed, whether it is used by a column, inside an array, or as a domain's base type (Task 2).
4. Apostrophes in comments, enum values and defaults are escaped as `''` in the DDL (Task 4).
5. A domain that uses an enum is emitted after it, whatever order they are stored in (Task 4).
6. `generated` and a non-empty `default` on the same column is an issue (Task 1), and the Inspector never lets both be set (Task 7).
7. Two enums with the same values cannot be used as each other's foreign key type (Task 1).

---

### Task 1: Core types and validation

**Files:**
- Modify: `packages/core/src/schema/types.ts`
- Create: `packages/core/src/schema/type-shape.ts`
- Modify: `packages/core/src/schema/validate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/tests/unit/schema/model-validate.test.ts` (new), `packages/core/src/tests/unit/schema/type-shape.test.ts` (new)

**Interfaces:**
- Consumes: existing `Schema`, `Table`, `Column`, `ColumnType`, `validate`.
- Produces (used by every later task):
  - `type TypeId = string`, `type IndexId = string`
  - `SIMPLE_COLUMN_KINDS` now also contains `'smallint'`, `'timestamp_no_tz'`, `'time'`, `'interval'`, `'real'`, `'double'`, `'bytea'`
  - `ColumnType` adds `{ kind: 'char'; length: number }`, `{ kind: 'array'; of: ColumnType }`, `{ kind: 'user'; typeId: TypeId }`
  - `INDEX_METHODS = ['btree', 'hash', 'gin', 'gist'] as const`, `type IndexMethod`, `interface Index { id: IndexId; name: string; columns: ColumnId[]; unique: boolean; method: IndexMethod }`
  - `type UserType = EnumType | DomainType` with `EnumType = { kind: 'enum'; id: TypeId; name: string; values: string[] }` and `DomainType = { kind: 'domain'; id: TypeId; name: string; base: ColumnType; notNull?: boolean; default?: string }`
  - `Column` adds `default?: string`, `comment?: string`; `Table` adds `comment?: string`, `indexes?: Index[]`; `Schema` adds `types?: UserType[]`
  - `sameTypeShape(a: ColumnType, b: ColumnType): boolean` and `userTypeIdsOf(type: ColumnType): TypeId[]` from `schema/type-shape.ts`
  - `IssueCode` adds `'generated-with-default' | 'empty-index-name' | 'duplicate-index-name' | 'index-without-columns' | 'index-unknown-column' | 'index-duplicate-column' | 'empty-type-name' | 'duplicate-type-name' | 'enum-without-values' | 'enum-empty-value' | 'enum-duplicate-value' | 'unknown-type'`; `Issue` adds `indexId?: IndexId`, `typeId?: TypeId`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/tests/unit/schema/type-shape.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sameTypeShape, userTypeIdsOf } from '../../../schema/type-shape.ts'

describe('sameTypeShape', () => {
  it('compares the kind, ignoring length, precision and scale', () => {
    assert.equal(
      sameTypeShape({ kind: 'varchar', length: 10 }, { kind: 'varchar', length: 99 }),
      true
    )
    assert.equal(sameTypeShape({ kind: 'integer' }, { kind: 'bigint' }), false)
  })

  it('compares the element of an array', () => {
    const ints = { kind: 'array', of: { kind: 'integer' } } as const
    assert.equal(sameTypeShape(ints, { kind: 'array', of: { kind: 'integer' } }), true)
    assert.equal(sameTypeShape(ints, { kind: 'array', of: { kind: 'text' } }), false)
    assert.equal(sameTypeShape(ints, { kind: 'integer' }), false)
  })

  it('compares the id of a user type', () => {
    assert.equal(
      sameTypeShape({ kind: 'user', typeId: 'a' }, { kind: 'user', typeId: 'a' }),
      true
    )
    assert.equal(
      sameTypeShape({ kind: 'user', typeId: 'a' }, { kind: 'user', typeId: 'b' }),
      false
    )
  })
})

describe('userTypeIdsOf', () => {
  it('finds a user type, also inside arrays', () => {
    assert.deepEqual(userTypeIdsOf({ kind: 'text' }), [])
    assert.deepEqual(userTypeIdsOf({ kind: 'user', typeId: 'a' }), ['a'])
    assert.deepEqual(
      userTypeIdsOf({ kind: 'array', of: { kind: 'user', typeId: 'a' } }),
      ['a']
    )
  })
})
```

`packages/core/src/tests/unit/schema/model-validate.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Column, ColumnType, Schema, Table, UserType } from '../../../schema/types.ts'
import { validate } from '../../../schema/validate.ts'

const col = (id: string, name: string, type: ColumnType = { kind: 'text' }): Column => ({
  id,
  name,
  type,
  nullable: true,
})
const tbl = (id: string, name: string, columns: Column[], extra: Partial<Table> = {}): Table => ({
  id,
  name,
  columns,
  primaryKey: [],
  ...extra,
})
const schemaOf = (tables: Table[], types?: UserType[]): Schema => ({
  version: 1,
  tables,
  relationships: [],
  ...(types ? { types } : {}),
})
const codes = (schema: Schema) => validate(schema).map((issue) => issue.code)

describe('validate: a schema without the new fields', () => {
  it('is valid, as every project saved before them is', () => {
    assert.deepEqual(validate(schemaOf([tbl('t', 'users', [col('c', 'id')])])), [])
  })
})

describe('validate: default', () => {
  it('flags a column that is both generated and has a default', () => {
    const column = { ...col('c', 'id', { kind: 'integer' }), generated: true, default: '0' }
    assert.deepEqual(codes(schemaOf([tbl('t', 'users', [column])])), ['generated-with-default'])
  })

  it('allows a default on its own, and an empty default next to generated', () => {
    const plain = { ...col('c', 'n', { kind: 'integer' }), default: '0' }
    const blank = { ...col('d', 'id', { kind: 'integer' }), generated: true, default: '' }
    assert.deepEqual(codes(schemaOf([tbl('t', 'users', [plain, blank])])), [])
  })
})

describe('validate: indexes', () => {
  const index = (over: object = {}) => ({
    id: 'i1',
    name: 'idx_a',
    columns: ['c1'],
    unique: false,
    method: 'btree' as const,
    ...over,
  })
  const withIndexes = (...indexes: ReturnType<typeof index>[]) =>
    schemaOf([tbl('t', 'users', [col('c1', 'a'), col('c2', 'b')], { indexes })])

  it('accepts a normal index', () => {
    assert.deepEqual(codes(withIndexes(index())), [])
  })

  it('flags an empty name, no columns, an unknown column and a repeated column', () => {
    assert.deepEqual(codes(withIndexes(index({ name: ' ' }))), ['empty-index-name'])
    assert.deepEqual(codes(withIndexes(index({ columns: [] }))), ['index-without-columns'])
    assert.deepEqual(codes(withIndexes(index({ columns: ['zz'] }))), ['index-unknown-column'])
    assert.deepEqual(codes(withIndexes(index({ columns: ['c1', 'c1'] }))), ['index-duplicate-column'])
  })

  it('flags a name used twice, across tables too', () => {
    assert.deepEqual(codes(withIndexes(index(), index({ id: 'i2' }))), ['duplicate-index-name'])
    const across = schemaOf([
      tbl('t', 'a', [col('c1', 'x')], { indexes: [index()] }),
      tbl('u', 'b', [col('c1', 'x')], { indexes: [index({ id: 'i2' })] }),
    ])
    assert.deepEqual(codes(across), ['duplicate-index-name'])
  })

  it('reports the table and the index', () => {
    const [found] = validate(withIndexes(index({ columns: [] })))
    assert.equal(found?.tableId, 't')
    assert.equal(found?.indexId, 'i1')
  })
})

describe('validate: user types', () => {
  const colour: UserType = { kind: 'enum', id: 'e1', name: 'colour', values: ['red', 'green'] }

  it('accepts an enum and a column that uses it, also inside an array', () => {
    const used = col('c', 'c', { kind: 'user', typeId: 'e1' })
    const many = col('d', 'd', { kind: 'array', of: { kind: 'user', typeId: 'e1' } })
    assert.deepEqual(codes(schemaOf([tbl('t', 'x', [used, many])], [colour])), [])
  })

  it('flags a column whose type does not exist', () => {
    const lost = col('c', 'c', { kind: 'user', typeId: 'nope' })
    assert.deepEqual(codes(schemaOf([tbl('t', 'x', [lost])], [colour])), ['unknown-type'])
    assert.deepEqual(codes(schemaOf([tbl('t', 'x', [lost])])), ['unknown-type'])
  })

  it('flags an empty or repeated type name', () => {
    assert.deepEqual(codes(schemaOf([], [{ ...colour, name: '' }])), ['empty-type-name'])
    assert.deepEqual(codes(schemaOf([], [colour, { ...colour, id: 'e2' }])), ['duplicate-type-name'])
  })

  it('flags an enum with no values, an empty value, or a repeated value', () => {
    assert.deepEqual(codes(schemaOf([], [{ ...colour, values: [] }])), ['enum-without-values'])
    assert.deepEqual(codes(schemaOf([], [{ ...colour, values: ['a', ''] }])), ['enum-empty-value'])
    assert.deepEqual(codes(schemaOf([], [{ ...colour, values: ['a', 'a'] }])), ['enum-duplicate-value'])
  })

  it('flags a domain whose base type does not exist', () => {
    const domain: UserType = { kind: 'domain', id: 'd1', name: 'age', base: { kind: 'user', typeId: 'zz' } }
    assert.deepEqual(codes(schemaOf([], [domain])), ['unknown-type'])
  })
})

describe('validate: relationships between user types', () => {
  const enumA: UserType = { kind: 'enum', id: 'a', name: 'a', values: ['x'] }
  const enumB: UserType = { kind: 'enum', id: 'b', name: 'b', values: ['x'] }
  const build = (from: ColumnType, to: ColumnType): Schema => ({
    ...schemaOf(
      [
        { id: 't1', name: 'child', columns: [col('c1', 'k', from)], primaryKey: [] },
        { id: 't2', name: 'parent', columns: [col('c2', 'k', to)], primaryKey: ['c2'] },
      ],
      [enumA, enumB]
    ),
    relationships: [
      { id: 'r', from: { tableId: 't1', columnId: 'c1' }, to: { tableId: 't2', columnId: 'c2' } },
    ],
  })

  it('accepts the same user type and flags two different ones with equal values', () => {
    assert.deepEqual(codes(build({ kind: 'user', typeId: 'a' }, { kind: 'user', typeId: 'a' })), [])
    assert.deepEqual(codes(build({ kind: 'user', typeId: 'a' }, { kind: 'user', typeId: 'b' })), [
      'relationship-type-mismatch',
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/schema/type-shape.test.ts src/tests/unit/schema/model-validate.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE|SyntaxError"`
Expected: FAIL (`ERR_MODULE_NOT_FOUND` for `type-shape.ts`; the type errors do not stop `node --test`, so the validate tests fail on missing issue codes).

- [ ] **Step 3: Implement types**

Edit `packages/core/src/schema/types.ts`. Replace the header block through `ColumnType` with:

```ts
export type TableId = string
export type ColumnId = string
export type RelationshipId = string
export type TypeId = string
export type IndexId = string

export const SIMPLE_COLUMN_KINDS = [
  'integer',
  'bigint',
  'smallint',
  'text',
  'boolean',
  'uuid',
  'timestamp',
  'timestamp_no_tz',
  'time',
  'date',
  'interval',
  'json',
  'real',
  'double',
  'bytea',
] as const

export type SimpleColumnKind = (typeof SIMPLE_COLUMN_KINDS)[number]

// PostgreSQL limits: varchar(n) up to 10485760, numeric precision up to 1000.
// They live here so the parser and every UI that edits a type share one value.
export const MAX_VARCHAR_LENGTH = 10_485_760
export const MAX_NUMERIC_PRECISION = 1000

export type ColumnType =
  | { kind: SimpleColumnKind }
  | { kind: 'varchar'; length: number }
  | { kind: 'char'; length: number }
  | { kind: 'numeric'; precision: number; scale: number }
  | { kind: 'array'; of: ColumnType }
  | { kind: 'user'; typeId: TypeId }
```

Keep `GENERATED_COLUMN_KINDS` as is. Add `default?: string` and `comment?: string` to `Column` (with a doc comment: `/** A raw SQL expression, written as is. Empty means none; it excludes `generated`. */` and `/** Free text, emitted as COMMENT ON. Empty means none. */`). Replace `Table` with:

```ts
export const INDEX_METHODS = ['btree', 'hash', 'gin', 'gist'] as const
export type IndexMethod = (typeof INDEX_METHODS)[number]

export interface Index {
  id: IndexId
  name: string
  /** In the order the index sorts them. */
  columns: ColumnId[]
  unique: boolean
  method: IndexMethod
}

export interface Table {
  id: TableId
  name: string
  columns: Column[]
  primaryKey: ColumnId[]
  comment?: string
  /** Absent means none, which keeps projects saved before indexes valid. */
  indexes?: Index[]
}

export interface EnumType {
  kind: 'enum'
  id: TypeId
  name: string
  values: string[]
}

/** A domain's CHECK is not modelled. */
export interface DomainType {
  kind: 'domain'
  id: TypeId
  name: string
  base: ColumnType
  notNull?: boolean
  default?: string
}

export type UserType = EnumType | DomainType
```

and `Schema` gets `types?: UserType[]` after `relationships`.

Create `packages/core/src/schema/type-shape.ts`:

```ts
import type { ColumnType, TypeId } from './types.ts'

/**
 * Whether two column types are the same for a foreign key: the same kind, the
 * same element for arrays, the same type for user types. Length, precision and
 * scale are ignored, as PostgreSQL lets a foreign key differ in those.
 */
export function sameTypeShape(a: ColumnType, b: ColumnType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'array' && b.kind === 'array') {
    return sameTypeShape(a.of, b.of)
  }
  if (a.kind === 'user' && b.kind === 'user') return a.typeId === b.typeId
  return true
}

/** The ids of the user types a column type mentions, arrays included. */
export function userTypeIdsOf(type: ColumnType): TypeId[] {
  if (type.kind === 'array') return userTypeIdsOf(type.of)
  return type.kind === 'user' ? [type.typeId] : []
}
```

- [ ] **Step 4: Implement validation**

In `packages/core/src/schema/validate.ts`: extend `IssueCode` and `Issue`/`IssueIds`/`issue()` with the codes and the optional `indexId`, `typeId` listed under Interfaces (copy them in the same style as `relationshipId`). Import `sameTypeShape`, `userTypeIdsOf` and the new types. Replace the mismatch condition `source.column.type.kind !== target.column.type.kind` with `!sameTypeShape(source.column.type, target.column.type)`. In `validate()`:

1. Before the table loop add `const types = schema.types ?? []`, `const typeIds = new Set(types.map((type) => type.id))`, `const seenIndexNames = new Set<string>()`.
2. Inside the column loop, after the generated check, add:

```ts
      if (column.generated && (column.default ?? '').trim() !== '') {
        issues.push(
          issue(
            'generated-with-default',
            `Column "${table.name}.${column.name}" is generated and also has a default: choose one.`,
            ids
          )
        )
      }
      if (userTypeIdsOf(column.type).some((id) => !typeIds.has(id))) {
        issues.push(
          issue(
            'unknown-type',
            `Column "${table.name}.${column.name}" uses a type that does not exist.`,
            ids
          )
        )
      }
```

3. After the column loop (still inside the table loop) add the index checks:

```ts
    for (const index of table.indexes ?? []) {
      const ids = { tableId: table.id, indexId: index.id }
      if (isBlank(index.name)) {
        issues.push(issue('empty-index-name', `An index on table "${table.name}" has an empty name.`, ids))
      } else if (seenIndexNames.has(index.name)) {
        issues.push(issue('duplicate-index-name', `Index name "${index.name}" is used more than once.`, ids))
      }
      seenIndexNames.add(index.name)
      if (index.columns.length === 0) {
        issues.push(issue('index-without-columns', `Index "${index.name}" has no columns.`, ids))
      }
      const used = new Set<string>()
      for (const columnId of index.columns) {
        if (!table.columns.some((column) => column.id === columnId)) {
          issues.push(issue('index-unknown-column', `Index "${index.name}" uses a column that does not exist.`, ids))
        } else if (used.has(columnId)) {
          issues.push(issue('index-duplicate-column', `Index "${index.name}" uses a column twice.`, ids))
        }
        used.add(columnId)
      }
    }
```

4. After the relationship loop, before `return issues`, add the type checks:

```ts
  const seenTypeNames = new Set<string>()
  for (const userType of types) {
    const ids = { typeId: userType.id }
    if (isBlank(userType.name)) {
      issues.push(issue('empty-type-name', 'A type has an empty name.', ids))
    } else if (seenTypeNames.has(userType.name)) {
      issues.push(issue('duplicate-type-name', `Type name "${userType.name}" is used more than once.`, ids))
    }
    seenTypeNames.add(userType.name)
    if (userType.kind === 'enum') {
      if (userType.values.length === 0) {
        issues.push(issue('enum-without-values', `Enum "${userType.name}" has no values.`, ids))
      }
      const seenValues = new Set<string>()
      for (const value of userType.values) {
        if (value === '') {
          issues.push(issue('enum-empty-value', `Enum "${userType.name}" has an empty value.`, ids))
        } else if (seenValues.has(value)) {
          issues.push(issue('enum-duplicate-value', `Enum "${userType.name}" repeats the value "${value}".`, ids))
        }
        seenValues.add(value)
      }
    } else if (userTypeIdsOf(userType.base).some((id) => !typeIds.has(id))) {
      issues.push(issue('unknown-type', `Domain "${userType.name}" is based on a type that does not exist.`, ids))
    }
  }
```

Update the message of `generated-unsupported-type` only if an existing test pins it (it does not name the new kinds, so leave it).

In `packages/core/src/index.ts` export the new types and values: `Index`, `IndexId`, `IndexMethod`, `EnumType`, `DomainType`, `UserType`, `TypeId` (type exports), `INDEX_METHODS` (value), and `export { sameTypeShape, userTypeIdsOf } from './schema/type-shape.ts'`.

- [ ] **Step 5: Run the tests and the whole core suite**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/core typecheck 2>&1 | tail -5`
Expected: all pass. Typecheck will report the `switch` over `ColumnType` in `dialects/postgres.ts` as non-exhaustive (new kinds) and the same in the web: that is fixed in Tasks 4 and 5; if the core typecheck fails only there, proceed. If an existing test pins the old `SIMPLE_COLUMN_KINDS` list, update it to the new list.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): model indexes, comments, defaults, array and user types, and validate them

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Core operations

**Files:**
- Modify: `packages/core/src/schema/operations.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/tests/unit/schema/model-operations.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 types, `userTypeIdsOf`.
- Produces:
  - `setTableComment(schema, tableId, comment: string): Schema` (empty or blank removes the key)
  - `addIndex(schema, tableId, index: Index): Schema`, `updateIndex(schema, tableId, indexId, patch: Partial<Omit<Index, 'id'>>): Schema`, `removeIndex(schema, tableId, indexId): Schema`
  - `addType(schema, type: UserType): Schema`, `updateType(schema, type: UserType): Schema` (replaces the type with the same id), `removeType(schema, typeId): Schema` (returns the same schema when the type is in use)
  - `typeUsages(schema, typeId): TypeUsage[]` with `type TypeUsage = { kind: 'column'; tableId: TableId; columnId: ColumnId } | { kind: 'domain'; typeId: TypeId }`
  - `removeColumn` now also shrinks or drops the indexes that used the column.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/tests/unit/schema/model-operations.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  addColumn,
  addIndex,
  addTable,
  addType,
  createSchema,
  removeColumn,
  removeIndex,
  removeTable,
  removeType,
  setTableComment,
  typeUsages,
  updateIndex,
  updateType,
} from '../../../schema/operations.ts'
import type { Index, Schema, UserType } from '../../../schema/types.ts'

const idx = (over: Partial<Index> = {}): Index => ({
  id: 'i1',
  name: 'idx_a',
  columns: ['c1'],
  unique: false,
  method: 'btree',
  ...over,
})

function base(): Schema {
  let s = addTable(createSchema(), { id: 't', name: 'users' })
  s = addColumn(s, 't', { id: 'c1', name: 'a', type: { kind: 'text' }, nullable: true })
  s = addColumn(s, 't', { id: 'c2', name: 'b', type: { kind: 'text' }, nullable: true })
  return s
}

describe('setTableComment', () => {
  it('sets a comment, and removes the key when it is blank', () => {
    const commented = setTableComment(base(), 't', 'People')
    assert.equal(commented.tables[0]?.comment, 'People')
    const cleared = setTableComment(commented, 't', '  ')
    assert.equal('comment' in (cleared.tables[0] ?? {}), false)
  })

  it('ignores an unknown table', () => {
    const s = base()
    assert.equal(setTableComment(s, 'nope', 'x'), s)
  })
})

describe('indexes', () => {
  it('adds, updates and removes an index, without touching the original', () => {
    const s = base()
    const added = addIndex(s, 't', idx())
    assert.equal(s.tables[0]?.indexes, undefined)
    assert.deepEqual(added.tables[0]?.indexes, [idx()])

    const updated = updateIndex(added, 't', 'i1', { unique: true, id: 'ignored' } as never)
    assert.equal(updated.tables[0]?.indexes?.[0]?.unique, true)
    assert.equal(updated.tables[0]?.indexes?.[0]?.id, 'i1')

    const removed = removeIndex(updated, 't', 'i1')
    assert.deepEqual(removed.tables[0]?.indexes, [])
  })

  it('ignores an unknown table or index', () => {
    const s = addIndex(base(), 't', idx())
    assert.equal(addIndex(s, 'nope', idx()), s)
    assert.equal(updateIndex(s, 't', 'nope', { unique: true }), s)
    assert.equal(removeIndex(s, 't', 'nope'), s)
  })

  it('removing a column drops it from an index, and drops an index left empty', () => {
    let s = addIndex(base(), 't', idx({ id: 'i1', columns: ['c1', 'c2'] }))
    s = addIndex(s, 't', idx({ id: 'i2', name: 'idx_b', columns: ['c1'] }))
    const after = removeColumn(s, 't', 'c1')
    assert.deepEqual(after.tables[0]?.indexes, [idx({ id: 'i1', columns: ['c2'] })])
  })

  it('removing a column leaves a table without indexes without an indexes key', () => {
    const after = removeColumn(base(), 't', 'c1')
    assert.equal('indexes' in (after.tables[0] ?? {}), false)
  })

  it('removing a table takes its indexes with it', () => {
    const s = removeTable(addIndex(base(), 't', idx()), 't')
    assert.deepEqual(s.tables, [])
  })
})

describe('user types', () => {
  const colour: UserType = { kind: 'enum', id: 'e1', name: 'colour', values: ['red'] }

  it('adds, updates and removes a type', () => {
    const added = addType(base(), colour)
    assert.deepEqual(added.types, [colour])
    const updated = updateType(added, { ...colour, values: ['red', 'green'] })
    assert.deepEqual(updated.types?.[0], { ...colour, values: ['red', 'green'] })
    assert.deepEqual(removeType(updated, 'e1').types, [])
  })

  it('finds where a type is used: a column, an array, a domain', () => {
    let s = addType(base(), colour)
    s = addType(s, { kind: 'domain', id: 'd1', name: 'shade', base: { kind: 'user', typeId: 'e1' } })
    s = addColumn(s, 't', { id: 'c3', name: 'x', type: { kind: 'user', typeId: 'e1' }, nullable: true })
    s = addColumn(s, 't', {
      id: 'c4',
      name: 'y',
      type: { kind: 'array', of: { kind: 'user', typeId: 'e1' } },
      nullable: true,
    })
    assert.deepEqual(typeUsages(s, 'e1'), [
      { kind: 'column', tableId: 't', columnId: 'c3' },
      { kind: 'column', tableId: 't', columnId: 'c4' },
      { kind: 'domain', typeId: 'd1' },
    ])
  })

  it('refuses to remove a type that is in use, and returns the same schema', () => {
    const s = addColumn(addType(base(), colour), 't', {
      id: 'c3',
      name: 'x',
      type: { kind: 'user', typeId: 'e1' },
      nullable: true,
    })
    assert.equal(removeType(s, 'e1'), s)
  })

  it('refuses to remove a type that a domain is based on', () => {
    let s = addType(base(), colour)
    s = addType(s, { kind: 'domain', id: 'd1', name: 'shade', base: { kind: 'user', typeId: 'e1' } })
    assert.equal(removeType(s, 'e1'), s)
    assert.deepEqual(removeType(s, 'd1').types?.map((type) => type.id), ['e1'])
  })

  it('ignores an unknown type', () => {
    const s = addType(base(), colour)
    assert.equal(updateType(s, { ...colour, id: 'nope' }), s)
    assert.equal(removeType(s, 'nope'), s)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/schema/model-operations.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|SyntaxError|does not provide"`
Expected: FAIL (the new operations are not exported).

- [ ] **Step 3: Implement**

In `packages/core/src/schema/operations.ts` import `Index`, `IndexId`, `TypeId`, `UserType` from `./types.ts` and `userTypeIdsOf` from `./type-shape.ts`, then add:

```ts
export function setTableComment(
  schema: Schema,
  tableId: TableId,
  comment: string
): Schema {
  if (!findTable(schema, tableId)) return schema
  return replaceTable(schema, tableId, (table) => {
    const { comment: _previous, ...rest } = table
    return comment.trim() === '' ? rest : { ...rest, comment }
  })
}

export function addIndex(
  schema: Schema,
  tableId: TableId,
  index: Index
): Schema {
  if (!findTable(schema, tableId)) return schema
  return replaceTable(schema, tableId, (table) => ({
    ...table,
    indexes: [...(table.indexes ?? []), index],
  }))
}

export function updateIndex(
  schema: Schema,
  tableId: TableId,
  indexId: IndexId,
  patch: Partial<Omit<Index, 'id'>>
): Schema {
  const table = findTable(schema, tableId)
  if (!table?.indexes?.some((index) => index.id === indexId)) return schema
  return replaceTable(schema, tableId, (current) => ({
    ...current,
    indexes: (current.indexes ?? []).map((index) =>
      index.id === indexId ? { ...index, ...patch, id: index.id } : index
    ),
  }))
}

export function removeIndex(
  schema: Schema,
  tableId: TableId,
  indexId: IndexId
): Schema {
  const table = findTable(schema, tableId)
  if (!table?.indexes?.some((index) => index.id === indexId)) return schema
  return replaceTable(schema, tableId, (current) => ({
    ...current,
    indexes: (current.indexes ?? []).filter((index) => index.id !== indexId),
  }))
}

export function addType(schema: Schema, type: UserType): Schema {
  return { ...schema, types: [...(schema.types ?? []), type] }
}

/** Replaces the type that has the same id. */
export function updateType(schema: Schema, type: UserType): Schema {
  if (!schema.types?.some((candidate) => candidate.id === type.id)) {
    return schema
  }
  return {
    ...schema,
    types: schema.types.map((candidate) =>
      candidate.id === type.id ? type : candidate
    ),
  }
}

export type TypeUsage =
  | { kind: 'column'; tableId: TableId; columnId: ColumnId }
  | { kind: 'domain'; typeId: TypeId }

/** Everything that mentions a user type, so a UI can say why it cannot go. */
export function typeUsages(schema: Schema, typeId: TypeId): TypeUsage[] {
  const usages: TypeUsage[] = []
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (userTypeIdsOf(column.type).includes(typeId)) {
        usages.push({ kind: 'column', tableId: table.id, columnId: column.id })
      }
    }
  }
  for (const type of schema.types ?? []) {
    if (type.kind === 'domain' && userTypeIdsOf(type.base).includes(typeId)) {
      usages.push({ kind: 'domain', typeId: type.id })
    }
  }
  return usages
}

/** A type that is still used stays: the schema comes back unchanged. */
export function removeType(schema: Schema, typeId: TypeId): Schema {
  if (!schema.types?.some((type) => type.id === typeId)) return schema
  if (typeUsages(schema, typeId).length > 0) return schema
  return {
    ...schema,
    types: schema.types.filter((type) => type.id !== typeId),
  }
}
```

In `removeColumn`, change the `replaceTable` update to also fix indexes:

```ts
  const withoutColumn = replaceTable(schema, tableId, (current) => {
    const indexes = current.indexes
      ?.map((index) => ({
        ...index,
        columns: index.columns.filter((id) => id !== columnId),
      }))
      .filter((index) => index.columns.length > 0)
    return {
      ...current,
      columns: current.columns.filter((column) => column.id !== columnId),
      primaryKey: current.primaryKey.filter((id) => id !== columnId),
      ...(indexes ? { indexes } : {}),
    }
  })
```

Export `addIndex`, `addType`, `removeIndex`, `removeType`, `setTableComment`, `typeUsages`, `updateIndex`, `updateType` and `type TypeUsage` from `packages/core/src/index.ts`.

- [ ] **Step 4: Run tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): operations for table comments, indexes and user types

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Project parsing of the new fields

**Files:**
- Modify: `packages/core/src/project/parse-project.ts`
- Test: `packages/core/src/tests/unit/project/parse-model.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 types, `parseProject`.
- Produces: `parseProject` accepts and returns `comment`, `default`, `indexes`, `types`, the `char`, `array` and `user` column types, and the new simple kinds. A project without them parses to exactly what it did before (no new keys are added).

- [ ] **Step 1: Write the failing tests**

`packages/core/src/tests/unit/project/parse-model.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseProject } from '../../../project/parse-project.ts'

const project = (schema: object) => ({ formatVersion: 1, schema, view: null })
const table = (extra: object = {}, columns: object[] = [{ id: 'c1', name: 'a', type: { kind: 'text' }, nullable: true }]) => ({
  id: 't',
  name: 'users',
  columns,
  primaryKey: [],
  ...extra,
})
const schema = (extra: object = {}, tables: object[] = [table()]) => ({
  version: 1,
  tables,
  relationships: [],
  ...extra,
})

describe('parseProject: a project saved before the new fields', () => {
  it('parses to the same shape, with no new keys', () => {
    const result = parseProject(project(schema()))
    assert.equal(result.ok, true)
    if (result.ok) {
      const parsed = result.project.schema
      assert.deepEqual(Object.keys(parsed).sort(), ['relationships', 'tables', 'version'])
      assert.deepEqual(Object.keys(parsed.tables[0] ?? {}).sort(), ['columns', 'id', 'name', 'primaryKey'])
    }
  })
})

describe('parseProject: comments, defaults and indexes', () => {
  it('reads a table comment, a column comment and a column default', () => {
    const column = { id: 'c1', name: 'a', type: { kind: 'text' }, nullable: true, comment: 'hi', default: "'x'" }
    const result = parseProject(project(schema({}, [table({ comment: 'People' }, [column])])))
    assert.equal(result.ok, true)
    if (result.ok) {
      const parsed = result.project.schema.tables[0]
      assert.equal(parsed?.comment, 'People')
      assert.equal(parsed?.columns[0]?.comment, 'hi')
      assert.equal(parsed?.columns[0]?.default, "'x'")
    }
  })

  it('reads indexes', () => {
    const indexes = [{ id: 'i1', name: 'idx_a', columns: ['c1'], unique: true, method: 'gin' }]
    const result = parseProject(project(schema({}, [table({ indexes })])))
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.project.schema.tables[0]?.indexes, indexes)
  })

  it('rejects wrong types for them, with the path', () => {
    const bad = (extra: object, column: object = {}) =>
      parseProject(
        project(
          schema({}, [
            table(extra, [{ id: 'c1', name: 'a', type: { kind: 'text' }, nullable: true, ...column }]),
          ])
        )
      )
    const paths = (result: ReturnType<typeof parseProject>) =>
      result.ok ? [] : result.errors.map((error) => error.path)

    assert.ok(paths(bad({ comment: 3 })).includes('schema.tables[0].comment'))
    assert.ok(paths(bad({}, { comment: 3 })).includes('schema.tables[0].columns[0].comment'))
    assert.ok(paths(bad({}, { default: 3 })).includes('schema.tables[0].columns[0].default'))
    assert.ok(paths(bad({ indexes: 'x' })).includes('schema.tables[0].indexes'))
    assert.ok(
      paths(bad({ indexes: [{ id: 'i', name: 'n', columns: ['zz'], unique: false, method: 'btree' }] })).includes(
        'schema.tables[0].indexes[0].columns[0]'
      )
    )
    assert.ok(
      paths(bad({ indexes: [{ id: 'i', name: 'n', columns: ['c1'], unique: false, method: 'rtree' }] })).includes(
        'schema.tables[0].indexes[0].method'
      )
    )
  })
})

describe('parseProject: types', () => {
  const enumType = { kind: 'enum', id: 'e1', name: 'colour', values: ['red', 'green'] }
  const colourColumn = (type: object) => [{ id: 'c1', name: 'a', type, nullable: true }]

  it('reads enums and domains', () => {
    const domain = { kind: 'domain', id: 'd1', name: 'age', base: { kind: 'integer' }, notNull: true, default: '0' }
    const result = parseProject(project(schema({ types: [enumType, domain] })))
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.project.schema.types, [enumType, domain])
  })

  it('reads char, array and user column types', () => {
    const types = [
      { kind: 'char', length: 3 },
      { kind: 'array', of: { kind: 'integer' } },
      { kind: 'array', of: { kind: 'user', typeId: 'e1' } },
      { kind: 'user', typeId: 'e1' },
      { kind: 'smallint' },
      { kind: 'timestamp_no_tz' },
      { kind: 'double' },
    ]
    for (const type of types) {
      const result = parseProject(project(schema({ types: [enumType] }, [table({}, colourColumn(type))])))
      assert.equal(result.ok, true, JSON.stringify(type))
      if (result.ok) assert.deepEqual(result.project.schema.tables[0]?.columns[0]?.type, type)
    }
  })

  it('rejects a user type that does not exist, a bad char length and a bad array', () => {
    const fails = (type: object) =>
      !parseProject(project(schema({ types: [enumType] }, [table({}, colourColumn(type))]))).ok
    assert.equal(fails({ kind: 'user', typeId: 'nope' }), true)
    assert.equal(fails({ kind: 'user' }), true)
    assert.equal(fails({ kind: 'char', length: 0 }), true)
    assert.equal(fails({ kind: 'array' }), true)
    assert.equal(fails({ kind: 'array', of: { kind: 'user', typeId: 'nope' } }), true)
  })

  it('rejects an invalid type entry with its path', () => {
    const result = parseProject(project(schema({ types: [{ kind: 'enum', id: 'e', name: 'n', values: [1] }] })))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.errors.some((error) => error.path === 'schema.types[0].values[0]'))
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/project/parse-model.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL (several tests; the parser ignores or rejects the new fields).

- [ ] **Step 3: Implement**

In `parse-project.ts`:

1. Import `INDEX_METHODS`, `Index`, `IndexMethod`, `UserType` from `../schema/types.ts`.
2. Add a helper next to `readString`:

```ts
function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fail: Fail
): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    fail(`${path}.${key}`, `"${key}" must be a string.`)
    return undefined
  }
  return value
}
```

3. Give `parseType` a fourth parameter `typeIds?: ReadonlySet<string>` and the new branches (before the final `fail(path, \`Unknown column type…\`)`):

```ts
  if (kind === 'char') {
    const length = raw.length
    if (!isInteger(length) || length < 1 || length > MAX_VARCHAR_LENGTH) {
      fail(path, `char needs an integer length from 1 to ${MAX_VARCHAR_LENGTH}.`)
      return undefined
    }
    return { kind: 'char', length }
  }
  if (kind === 'array') {
    const of = parseType(raw.of, `${path}.of`, fail, typeIds)
    return of ? { kind: 'array', of } : undefined
  }
  if (kind === 'user') {
    if (typeof raw.typeId !== 'string') {
      fail(`${path}.typeId`, 'A user type needs a "typeId".')
      return undefined
    }
    if (typeIds && !typeIds.has(raw.typeId)) {
      fail(`${path}.typeId`, `The type "${raw.typeId}" does not exist.`)
      return undefined
    }
    return { kind: 'user', typeId: raw.typeId }
  }
```

4. `parseColumn(raw, path, fail, typeIds)`: pass `typeIds` to `parseType`; read `comment` and `default` with `readOptionalString` (an invalid one makes the column undefined like the other invalid fields) and spread them into the result only when defined: `...(comment === undefined ? {} : { comment })`, same for `default`.
5. `parseTable(raw, path, fail, typeIds)`: pass `typeIds` to `parseColumn`; after `primaryKey`, read `comment` with `readOptionalString`; parse `raw.indexes` when it is not `undefined`: it must be an array (`fail(\`${path}.indexes\`, '"indexes" must be an array.')`), and each entry an object with string `id`, string `name`, `columns` an array of ids that exist in `columnIds` (error path `${indexPath}.columns[${i}]`), boolean `unique`, and `method` in `INDEX_METHODS` (error path `${indexPath}.method`). Return `{ id, name, columns, primaryKey, ...(comment === undefined ? {} : { comment }), ...(indexes ? { indexes } : {}) }`.
6. `parseSchema`: before the tables, collect `typeIds` from `raw.types` (when it is an array: the string `id` of each object entry), parse `raw.types` when not `undefined` (must be an array, error path `${path}.types`) into `UserType[]`: an `enum` needs string `name`, `values` an array of strings (error path `${typePath}.values[${i}]`); a `domain` needs string `name`, `base` via `parseType(..., typeIds)`, optional boolean `notNull`, optional string `default`; any other `kind` is an error at `${typePath}.kind`; ids must be unique strings. Pass `typeIds` to `parseTable`. Return `{ version: 1, tables, relationships, ...(types ? { types } : {}) }`.

- [ ] **Step 4: Run tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"`
Expected: all pass, including the existing parse and round-trip tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): read comments, defaults, indexes, user types and the new column types from a saved project

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: PostgreSQL dialect and DDL generation

**Files:**
- Modify: `packages/core/src/dialects/dialect.ts`, `packages/core/src/dialects/postgres.ts`
- Modify: `packages/core/src/sql/generate/generate-ddl.ts`
- Modify: `packages/core/src/index.ts` (no new export needed unless `DdlStatement` kinds change its export; it already exports the type)
- Test: `packages/core/src/tests/unit/dialects/postgres-model.test.ts` (new), `packages/core/src/tests/integration/sql/model-ddl.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `Dialect.typeName(type, userTypeName?: (typeId: string) => string): string` and `Dialect.quoteLiteral(text: string): string`
  - `DdlStatement` adds `{ kind: 'type'; key: string; typeId: string; sql: string }`, `{ kind: 'index'; key: string; tableId: string; indexId: string; sql: string }`, `{ kind: 'comment'; key: string; tableId: string; sql: string }`
  - Script order: types (enums first, then domains, a domain after the types it uses), `CREATE TABLE`s (existing order), deferred `ALTER TABLE` FKs, `CREATE INDEX`es (table order, then index order), `COMMENT ON TABLE` then its columns' `COMMENT ON COLUMN`, per table in schema order.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/tests/unit/dialects/postgres-model.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'

describe('postgres.typeName: the new kinds', () => {
  it('names the native kinds', () => {
    const names: [Parameters<typeof postgres.typeName>[0], string][] = [
      [{ kind: 'smallint' }, 'smallint'],
      [{ kind: 'real' }, 'real'],
      [{ kind: 'double' }, 'double precision'],
      [{ kind: 'time' }, 'time'],
      [{ kind: 'timestamp_no_tz' }, 'timestamp'],
      [{ kind: 'interval' }, 'interval'],
      [{ kind: 'bytea' }, 'bytea'],
      [{ kind: 'char', length: 3 }, 'char(3)'],
    ]
    for (const [type, expected] of names) assert.equal(postgres.typeName(type), expected)
  })

  it('keeps the logical timestamp as timestamptz and json as jsonb', () => {
    assert.equal(postgres.typeName({ kind: 'timestamp' }), 'timestamptz')
    assert.equal(postgres.typeName({ kind: 'json' }), 'jsonb')
  })

  it('writes arrays and user types', () => {
    assert.equal(postgres.typeName({ kind: 'array', of: { kind: 'integer' } }), 'integer[]')
    assert.equal(
      postgres.typeName({ kind: 'array', of: { kind: 'varchar', length: 9 } }),
      'varchar(9)[]'
    )
    assert.equal(
      postgres.typeName({ kind: 'user', typeId: 'e1' }, (id) => `"${id}_name"`),
      '"e1_name"'
    )
  })
})

describe('postgres.quoteLiteral', () => {
  it('wraps in single quotes and doubles the ones inside', () => {
    assert.equal(postgres.quoteLiteral("it's"), "'it''s'")
    assert.equal(postgres.quoteLiteral(''), "''")
  })
})
```

`packages/core/src/tests/integration/sql/model-ddl.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import type { Column, ColumnType, Schema, Table, UserType } from '../../../schema/types.ts'
import { generateDdl } from '../../../sql/generate/generate-ddl.ts'

const col = (id: string, name: string, type: ColumnType = { kind: 'text' }, extra: Partial<Column> = {}): Column => ({
  id,
  name,
  type,
  nullable: true,
  ...extra,
})
const tbl = (id: string, name: string, columns: Column[], extra: Partial<Table> = {}): Table => ({
  id,
  name,
  columns,
  primaryKey: [],
  ...extra,
})
const schemaOf = (tables: Table[], types?: UserType[]): Schema => ({
  version: 1,
  tables,
  relationships: [],
  ...(types ? { types } : {}),
})
const run = (schema: Schema) => {
  const result = generateDdl(schema, postgres)
  assert.equal(result.ok, true)
  return result.ok ? result : { sql: '', statements: [] }
}
const lines = (...parts: string[]) => `${parts.join('\n')}\n`

describe('generateDdl: a schema with none of the new fields', () => {
  it('is unchanged', () => {
    const { sql, statements } = run(schemaOf([tbl('t', 'users', [col('c', 'name')])]))
    assert.equal(sql, lines('CREATE TABLE "users" (', '  "name" text', ');'))
    assert.deepEqual(statements.map((s) => s.kind), ['create'])
  })
})

describe('generateDdl: defaults', () => {
  it('writes the raw default after the type and NOT NULL', () => {
    const columns = [
      col('a', 'n', { kind: 'integer' }, { default: '0', nullable: false }),
      col('b', 's', { kind: 'text' }, { default: "'it''s'" }),
      col('c', 'z', { kind: 'text' }, { default: '  ' }),
    ]
    assert.equal(
      run(schemaOf([tbl('t', 'x', columns)])).sql,
      lines(
        'CREATE TABLE "x" (',
        '  "n" integer NOT NULL DEFAULT 0,',
        `  "s" text DEFAULT 'it''s',`,
        '  "z" text',
        ');'
      )
    )
  })
})

describe('generateDdl: types', () => {
  const enumType: UserType = { kind: 'enum', id: 'e1', name: 'order status', values: ['new', "won't ship"] }

  it('creates an enum before the table that uses it, and writes the column type by name', () => {
    const { sql, statements } = run(
      schemaOf([tbl('t', 'orders', [col('c', 'status', { kind: 'user', typeId: 'e1' })])], [enumType])
    )
    assert.equal(
      sql,
      lines(
        `CREATE TYPE "order status" AS ENUM ('new', 'won''t ship');`,
        '',
        'CREATE TABLE "orders" (',
        '  "status" "order status"',
        ');'
      )
    )
    assert.deepEqual(statements.map((s) => s.kind), ['type', 'create'])
    assert.equal(statements[0]?.kind === 'type' && statements[0].typeId, 'e1')
  })

  it('creates a domain after the enum it uses, whatever the stored order', () => {
    const domain: UserType = {
      kind: 'domain',
      id: 'd1',
      name: 'shade',
      base: { kind: 'user', typeId: 'e1' },
      default: "'new'",
      notNull: true,
    }
    const { sql } = run(schemaOf([], [domain, enumType]))
    assert.equal(
      sql,
      lines(
        `CREATE TYPE "order status" AS ENUM ('new', 'won''t ship');`,
        '',
        `CREATE DOMAIN "shade" AS "order status" DEFAULT 'new' NOT NULL;`
      )
    )
  })

  it('writes arrays of user types', () => {
    const { sql } = run(
      schemaOf(
        [tbl('t', 'x', [col('c', 'tags', { kind: 'array', of: { kind: 'user', typeId: 'e1' } })])],
        [enumType]
      )
    )
    assert.ok(sql.includes('"tags" "order status"[]'))
  })
})

describe('generateDdl: indexes', () => {
  const columns = [col('c1', 'a'), col('c2', 'b')]
  const index = (over: object = {}) => ({
    id: 'i1',
    name: 'idx_x_a',
    columns: ['c1'],
    unique: false,
    method: 'btree' as const,
    ...over,
  })

  it('writes a plain, a unique, and a method index after the tables', () => {
    const { sql, statements } = run(
      schemaOf([
        tbl('t', 'x', columns, {
          indexes: [
            index(),
            index({ id: 'i2', name: 'uq_x_a_b', columns: ['c1', 'c2'], unique: true }),
            index({ id: 'i3', name: 'idx_x_b', columns: ['c2'], method: 'gin' }),
          ],
        }),
      ])
    )
    assert.equal(
      sql,
      lines(
        'CREATE TABLE "x" (',
        '  "a" text,',
        '  "b" text',
        ');',
        '',
        'CREATE INDEX "idx_x_a" ON "x" ("a");',
        '',
        'CREATE UNIQUE INDEX "uq_x_a_b" ON "x" ("a", "b");',
        '',
        'CREATE INDEX "idx_x_b" ON "x" USING gin ("b");'
      )
    )
    const kinds = statements.map((s) => s.kind)
    assert.deepEqual(kinds, ['create', 'index', 'index', 'index'])
    const first = statements[1]
    assert.equal(first?.kind === 'index' && first.tableId, 't')
    assert.equal(first?.kind === 'index' && first.indexId, 'i1')
  })
})

describe('generateDdl: comments', () => {
  it('writes the table comment then the column comments, escaping quotes, skipping blanks', () => {
    const { sql, statements } = run(
      schemaOf([
        tbl('t', 'x', [col('c1', 'a', { kind: 'text' }, { comment: "the user's name" }), col('c2', 'b', { kind: 'text' }, { comment: ' ' })], {
          comment: 'People',
        }),
      ])
    )
    assert.equal(
      sql,
      lines(
        'CREATE TABLE "x" (',
        '  "a" text,',
        '  "b" text',
        ');',
        '',
        `COMMENT ON TABLE "x" IS 'People';`,
        '',
        `COMMENT ON COLUMN "x"."a" IS 'the user''s name';`
      )
    )
    assert.deepEqual(statements.map((s) => s.kind), ['create', 'comment', 'comment'])
    assert.equal(statements[1]?.kind === 'comment' && statements[1].tableId, 't')
  })
})

describe('generateDdl: the order of the whole script', () => {
  it('writes types, tables, foreign keys, indexes, then comments', () => {
    const enumType: UserType = { kind: 'enum', id: 'e1', name: 'k', values: ['a'] }
    const schema: Schema = {
      ...schemaOf(
        [
          tbl('t1', 'parent', [col('p', 'id', { kind: 'integer' })], { comment: 'P' }),
          tbl('t2', 'child', [col('q', 'parent_id', { kind: 'integer' }), col('k', 'kind', { kind: 'user', typeId: 'e1' })], {
            indexes: [{ id: 'i', name: 'idx_child', columns: ['q'], unique: false, method: 'btree' }],
          }),
        ],
        [enumType]
      ),
      relationships: [{ id: 'r', from: { tableId: 't2', columnId: 'q' }, to: { tableId: 't1', columnId: 'p' } }],
    }
    schema.tables[0] = { ...schema.tables[0]!, primaryKey: ['p'] }
    const { statements } = run(schema)
    assert.deepEqual(statements.map((s) => s.kind), ['type', 'create', 'create', 'index', 'comment'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/packages/core && node --test src/tests/unit/dialects/postgres-model.test.ts src/tests/integration/sql/model-ddl.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL.

- [ ] **Step 3: Implement the dialect**

`dialect.ts`: change `typeName` to `typeName(type: ColumnType, userTypeName?: (typeId: string) => string): string` and add `/** A string literal, quotes doubled. */ quoteLiteral(text: string): string`.

`postgres.ts`: change `typeName(type, userTypeName = (id) => id)` and add the cases:

```ts
    case 'smallint':
      return 'smallint'
    case 'real':
      return 'real'
    case 'double':
      return 'double precision'
    case 'time':
      return 'time'
    case 'timestamp_no_tz':
      return 'timestamp'
    case 'interval':
      return 'interval'
    case 'bytea':
      return 'bytea'
    case 'char':
      return `char(${type.length})`
    case 'array':
      return `${typeName(type.of, userTypeName)}[]`
    case 'user':
      return userTypeName(type.typeId)
```

plus `function quoteLiteral(text: string): string { return \`'${text.replaceAll("'", "''")}'\` }`, and `quoteLiteral` in the exported `postgres` object. Keep the `'timestamp'` and `'json'` cases as they are.

- [ ] **Step 4: Implement the generator**

In `generate-ddl.ts`:

1. Extend `DdlStatement` with the three kinds listed under Interfaces and update its doc comment.
2. Add helpers:

```ts
const present = (text: string | undefined): text is string =>
  text !== undefined && text.trim() !== ''

/** The SQL name of a column type; user types are written by their quoted name. */
function typeSql(schema: Schema, dialect: Dialect, type: ColumnType): string {
  return dialect.typeName(type, (typeId) => {
    const found = schema.types?.find((candidate) => candidate.id === typeId)
    return dialect.quoteIdentifier(found?.name ?? typeId)
  })
}

/** Enums first, then each domain after the types it is based on. */
function orderTypes(types: UserType[]): UserType[] {
  const ordered: UserType[] = types.filter((type) => type.kind === 'enum')
  const pending = types.filter((type) => type.kind === 'domain')
  while (pending.length > 0) {
    const next = pending.findIndex((domain) =>
      domain.kind === 'domain' &&
      userTypeIdsOf(domain.base).every((id) => ordered.some((done) => done.id === id))
    )
    ordered.push(...pending.splice(next === -1 ? 0 : next, 1))
  }
  return ordered
}

function createType(schema: Schema, type: UserType, dialect: Dialect): string {
  const name = dialect.quoteIdentifier(type.name)
  if (type.kind === 'enum') {
    const values = type.values.map((value) => dialect.quoteLiteral(value))
    return `CREATE TYPE ${name} AS ENUM (${values.join(', ')});`
  }
  const parts = [`CREATE DOMAIN ${name} AS ${typeSql(schema, dialect, type.base)}`]
  if (present(type.default)) parts.push(`DEFAULT ${type.default}`)
  if (type.notNull) parts.push('NOT NULL')
  return `${parts.join(' ')};`
}

function createIndex(table: Table, index: Index, dialect: Dialect): string {
  const quote = (name: string) => dialect.quoteIdentifier(name)
  const columns = index.columns.map((id) => quote(requireColumn(table, id).name))
  const using = index.method === 'btree' ? '' : ` USING ${index.method}`
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${quote(table.name)}${using} (${columns.join(', ')});`
}
```

3. In `createTable`, replace `dialect.typeName(column.type)` with `typeSql(schema, dialect, column.type)` and add the default after the type/`NOT NULL`, before the generated clause: `const dflt = present(column.default) && !column.generated ? \` DEFAULT ${column.default}\` : ''` and build the line as `` `  ${quote(column.name)} ${typeSql(...)}${required ? ' NOT NULL' : ''}${dflt}${generated ? ` ${generated}` : ''}` ``.
4. In `generateDdl`, build `statements` as: type statements first (`{ kind: 'type', key: \`type:${id}\`, typeId, sql }` for `orderTypes(schema.types ?? [])`), then the existing create statements, then the existing deferred alters, then for each table in schema order its indexes (`{ kind: 'index', key: \`index:${index.id}\`, tableId, indexId, sql }`), then for each table in schema order a `comment` statement for the table comment (key `comment:table:${table.id}`) followed by one per column with a comment (key `comment:column:${column.id}`), each `COMMENT ON TABLE "t" IS '…';` / `COMMENT ON COLUMN "t"."c" IS '…';` using `dialect.quoteLiteral`, only when `present(...)`. Update the imports (`ColumnType`, `Index`, `UserType`, `userTypeIdsOf`). The joined `sql` is unchanged (`statements.map(sql).join('\n\n') + '\n'`).

Fix any other caller of `dialect.typeName` that now needs the second argument (none in core besides the generator; the web calls `postgres.generatedImpliesNotNull` only).

- [ ] **Step 5: Run the whole core suite, lint and typecheck**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint:fix >/dev/null; pnpm --filter @forge/core test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/core typecheck 2>&1 | tail -3`
Expected: all pass; core typecheck clean (the web typecheck is fixed in Task 5).

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): generate CREATE TYPE, CREATE DOMAIN, defaults, indexes and comments

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web column-type helpers

**Files:**
- Modify: `apps/web/src/lib/column-types.ts`, `apps/web/src/lib/generated.ts`
- Modify (tests): `apps/web/src/tests/unit/lib/column-types.test.ts`, `apps/web/src/tests/unit/lib/generated.test.ts`
- Create (tests): `apps/web/src/tests/unit/lib/column-type-choices.test.ts`

**Interfaces:**
- Consumes: Task 1 `ColumnType`, `SIMPLE_COLUMN_KINDS`.
- Produces (used by Tasks 7, 9, 10):
  - `COLUMN_KINDS = [...SIMPLE_COLUMN_KINDS, 'varchar', 'char', 'numeric']`, `defaultColumnType('char')` = `{ kind: 'char', length: 1 }`
  - `kindLabel(kind: ColumnKind): string` (`timestamp_no_tz` shows as `timestamp (no tz)`, `double` as `double precision`, others as the kind)
  - `formatColumnType(type, userTypeName?: (typeId: string) => string): string` (arrays end in `[]`, user types show their name)
  - `baseType(type)`, `mapBase(type, change)`, `withArray(type, on)`, `choiceOf(type): string` (`'integer'`, `'varchar'`, … or `'user:<typeId>'`), `typeFromChoice(choice, asArray): ColumnType`
  - `typeChangePatch(column, type: ColumnType)` (was `(column, kind)`)

- [ ] **Step 1: Update and write the failing tests**

In `column-types.test.ts`, change the `COLUMN_KINDS` expectation to `[...SIMPLE_COLUMN_KINDS, 'varchar', 'char', 'numeric']` (import `SIMPLE_COLUMN_KINDS` from `@forge/core`) and keep every other existing assertion. In `generated.test.ts`, change each `typeChangePatch(column, '<kind>')` call to `typeChangePatch(column, defaultColumnType('<kind>'))` (import `defaultColumnType` from `../../../lib/column-types.ts`).

`column-type-choices.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ColumnType } from '@forge/core'

import {
  baseType,
  choiceOf,
  defaultColumnType,
  formatColumnType,
  kindLabel,
  mapBase,
  typeFromChoice,
  withArray,
} from '../../../lib/column-types.ts'

describe('defaultColumnType and kindLabel', () => {
  it('gives char a length of 1', () => {
    assert.deepEqual(defaultColumnType('char'), { kind: 'char', length: 1 })
  })

  it('labels the kinds a person would not guess from the identifier', () => {
    assert.equal(kindLabel('timestamp_no_tz'), 'timestamp (no tz)')
    assert.equal(kindLabel('double'), 'double precision')
    assert.equal(kindLabel('integer'), 'integer')
  })
})

describe('formatColumnType: the new kinds', () => {
  const names = (id: string) => (id === 'e1' ? 'mood' : '?')
  it('writes char, arrays and user types', () => {
    assert.equal(formatColumnType({ kind: 'char', length: 3 }), 'char(3)')
    assert.equal(formatColumnType({ kind: 'array', of: { kind: 'integer' } }), 'integer[]')
    assert.equal(formatColumnType({ kind: 'user', typeId: 'e1' }, names), 'mood')
    assert.equal(
      formatColumnType({ kind: 'array', of: { kind: 'user', typeId: 'e1' } }, names),
      'mood[]'
    )
    assert.equal(formatColumnType({ kind: 'timestamp_no_tz' }), 'timestamp (no tz)')
  })
})

describe('array and choice helpers', () => {
  const ints: ColumnType = { kind: 'array', of: { kind: 'integer' } }

  it('baseType and mapBase see through an array', () => {
    assert.deepEqual(baseType(ints), { kind: 'integer' })
    assert.deepEqual(baseType({ kind: 'text' }), { kind: 'text' })
    assert.deepEqual(
      mapBase({ kind: 'array', of: { kind: 'varchar', length: 5 } }, () => ({ kind: 'text' })),
      { kind: 'array', of: { kind: 'text' } }
    )
    assert.deepEqual(mapBase({ kind: 'integer' }, () => ({ kind: 'text' })), { kind: 'text' })
  })

  it('withArray wraps and unwraps, and is idempotent', () => {
    assert.deepEqual(withArray({ kind: 'integer' }, true), ints)
    assert.deepEqual(withArray(ints, true), ints)
    assert.deepEqual(withArray(ints, false), { kind: 'integer' })
    assert.deepEqual(withArray({ kind: 'integer' }, false), { kind: 'integer' })
  })

  it('choiceOf names the kind, or the user type, of the element', () => {
    assert.equal(choiceOf({ kind: 'varchar', length: 9 }), 'varchar')
    assert.equal(choiceOf(ints), 'integer')
    assert.equal(choiceOf({ kind: 'user', typeId: 'e1' }), 'user:e1')
    assert.equal(choiceOf({ kind: 'array', of: { kind: 'user', typeId: 'e1' } }), 'user:e1')
  })

  it('typeFromChoice builds the type, optionally as an array', () => {
    assert.deepEqual(typeFromChoice('varchar', false), { kind: 'varchar', length: 255 })
    assert.deepEqual(typeFromChoice('user:e1', false), { kind: 'user', typeId: 'e1' })
    assert.deepEqual(typeFromChoice('user:e1', true), {
      kind: 'array',
      of: { kind: 'user', typeId: 'e1' },
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/web && node --test src/tests/unit/lib/column-type-choices.test.ts src/tests/unit/lib/column-types.test.ts src/tests/unit/lib/generated.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|SyntaxError"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`column-types.ts`: set `COLUMN_KINDS = [...SIMPLE_COLUMN_KINDS, 'varchar', 'char', 'numeric'] as const`; add `case 'char': return { kind: 'char', length: 1 }` to `defaultColumnType`; add

```ts
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
  type.kind === 'array' ? type.of : type

/** Applies a change to the element of an array, or to the type itself. */
export function mapBase(
  type: ColumnType,
  change: (base: ColumnType) => ColumnType
): ColumnType {
  return type.kind === 'array' ? { kind: 'array', of: change(type.of) } : change(type)
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
```

Keep `setVarcharLength`, `setNumericPrecision`, `setNumericScale` unchanged (they operate on a base type; the Inspector wraps them with `mapBase`). `generated.ts`: change `typeChangePatch` to take the new type:

```ts
export function typeChangePatch(
  column: Column,
  type: ColumnType
): Partial<Omit<Column, 'id'>> {
  return column.generated && !supportsGenerated(type)
    ? { type, generated: false }
    : { type }
}
```

and drop the now-unused `ColumnKind`/`defaultColumnType` imports there.

- [ ] **Step 4: Run the web unit tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm --filter @forge/web test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"`
Expected: pass (the Inspector still compiles against the old `typeChangePatch` signature at runtime only in the browser; its typecheck is fixed in Task 7, so do not run `pnpm typecheck` as a gate here).

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): helpers for the new column types, arrays and user types

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Store actions

**Files:**
- Modify: `apps/web/src/lib/store/forge-store.ts`
- Test: `apps/web/src/tests/unit/lib/store/model-actions.test.ts` (new)

**Interfaces:**
- Consumes: Task 2 core operations (`setTableComment`, `addIndex`, `updateIndex`, `removeIndex`, `addType`, `updateType`, `removeType`, `typeUsages`).
- Produces on `ForgeState`:
  - `setTableComment(tableId, comment: string): void`
  - `addIndex(tableId): IndexId | null` (null when the table has no column; the index starts on the first column, named `idx_<table>_<column>`, made unique with `_2`, `_3`… against every index name)
  - `updateIndex(tableId, indexId, patch: Partial<Omit<Index, 'id'>>): void`, `removeIndex(tableId, indexId): void`
  - `addType(kind: 'enum' | 'domain'): TypeId` (named `type_N`; an enum starts with the value `value_1`, a domain on `text`)
  - `updateType(type: UserType): void`
  - `removeType(typeId): TypeUsage[]` (empty when removed; the blocking usages, with nothing changed, otherwise)

- [ ] **Step 1: Write the failing tests**

`model-actions.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createForgeStore } from '../../../../lib/store/forge-store.ts'

function makeStore() {
  let counter = 0
  const store = createForgeStore({ newId: () => `id-${++counter}` })
  store.getState().setNewTableId('none')
  return store
}

function withColumns() {
  const store = makeStore()
  const tableId = store.getState().addTable()
  const columnId = store.getState().addColumn(tableId)
  assert.ok(columnId)
  return { store, tableId, columnId }
}

describe('table comment', () => {
  it('sets and clears it', () => {
    const { store, tableId } = withColumns()
    store.getState().setTableComment(tableId, 'People')
    assert.equal(store.getState().schema.tables[0]?.comment, 'People')
    store.getState().setTableComment(tableId, '')
    assert.equal('comment' in (store.getState().schema.tables[0] ?? {}), false)
  })
})

describe('indexes', () => {
  it('adds an index on the first column, named after the table and the column', () => {
    const { store, tableId, columnId } = withColumns()
    const id = store.getState().addIndex(tableId)
    assert.ok(id)
    assert.deepEqual(store.getState().schema.tables[0]?.indexes, [
      { id, name: 'idx_table_1_column_1', columns: [columnId], unique: false, method: 'btree' },
    ])
  })

  it('does not add an index to a table with no columns', () => {
    const store = makeStore()
    const tableId = store.getState().addTable()
    assert.equal(store.getState().addIndex(tableId), null)
    assert.equal(store.getState().schema.tables[0]?.indexes, undefined)
  })

  it('gives a second index a name that is free', () => {
    const { store, tableId } = withColumns()
    store.getState().addIndex(tableId)
    store.getState().addIndex(tableId)
    const names = store.getState().schema.tables[0]?.indexes?.map((index) => index.name)
    assert.deepEqual(names, ['idx_table_1_column_1', 'idx_table_1_column_1_2'])
  })

  it('updates and removes an index', () => {
    const { store, tableId } = withColumns()
    const id = store.getState().addIndex(tableId)
    assert.ok(id)
    store.getState().updateIndex(tableId, id, { unique: true, name: 'uq_x' })
    assert.equal(store.getState().schema.tables[0]?.indexes?.[0]?.unique, true)
    assert.equal(store.getState().schema.tables[0]?.indexes?.[0]?.name, 'uq_x')
    store.getState().removeIndex(tableId, id)
    assert.deepEqual(store.getState().schema.tables[0]?.indexes, [])
  })
})

describe('user types', () => {
  it('adds an enum with one value and a domain on text, with free names', () => {
    const store = makeStore()
    const enumId = store.getState().addType('enum')
    const domainId = store.getState().addType('domain')
    assert.deepEqual(store.getState().schema.types, [
      { kind: 'enum', id: enumId, name: 'type_1', values: ['value_1'] },
      { kind: 'domain', id: domainId, name: 'type_2', base: { kind: 'text' } },
    ])
  })

  it('updates a type', () => {
    const store = makeStore()
    const id = store.getState().addType('enum')
    store.getState().updateType({ kind: 'enum', id, name: 'mood', values: ['a', 'b'] })
    assert.deepEqual(store.getState().schema.types?.[0], {
      kind: 'enum',
      id,
      name: 'mood',
      values: ['a', 'b'],
    })
  })

  it('removes a type nobody uses, and says what uses one that is used', () => {
    const { store, tableId, columnId } = withColumns()
    const typeId = store.getState().addType('enum')
    store.getState().updateColumn(tableId, columnId, { type: { kind: 'user', typeId } })

    const blocked = store.getState().removeType(typeId)
    assert.deepEqual(blocked, [{ kind: 'column', tableId, columnId }])
    assert.equal(store.getState().schema.types?.length, 1)

    store.getState().updateColumn(tableId, columnId, { type: { kind: 'text' } })
    assert.deepEqual(store.getState().removeType(typeId), [])
    assert.deepEqual(store.getState().schema.types, [])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/web && node --test src/tests/unit/lib/store/model-actions.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL (the actions do not exist).

- [ ] **Step 3: Implement**

In `forge-store.ts`: import `Index`, `IndexId`, `TypeId`, `TypeUsage`, `UserType` from `@forge/core`; add the signatures above to `ForgeState` (after `setPrimaryKey`); add a helper beside `firstFreeName`:

```ts
/** `base`, or `base_2`, `base_3`… until it is not taken. */
function freeName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base
  let attempt = 2
  while (taken.includes(`${base}_${attempt}`)) attempt++
  return `${base}_${attempt}`
}
```

and the actions after `setPrimaryKey`:

```ts
    setTableComment: (tableId, comment) =>
      set({ schema: core.setTableComment(get().schema, tableId, comment) }),

    addIndex: (tableId) => {
      const { schema } = get()
      const table = schema.tables.find((candidate) => candidate.id === tableId)
      const first = table?.columns[0]
      if (!table || !first) return null
      const taken = schema.tables.flatMap((candidate) =>
        (candidate.indexes ?? []).map((index) => index.name)
      )
      const id = newId()
      const index: Index = {
        id,
        name: freeName(`idx_${table.name}_${first.name}`, taken),
        columns: [first.id],
        unique: false,
        method: 'btree',
      }
      set({ schema: core.addIndex(schema, tableId, index) })
      return id
    },

    updateIndex: (tableId, indexId, patch) =>
      set({ schema: core.updateIndex(get().schema, tableId, indexId, patch) }),

    removeIndex: (tableId, indexId) =>
      set({ schema: core.removeIndex(get().schema, tableId, indexId) }),

    addType: (kind) => {
      const { schema } = get()
      const id = newId()
      const name = firstFreeName(
        'type',
        (schema.types ?? []).map((type) => type.name)
      )
      const type: UserType =
        kind === 'enum'
          ? { kind: 'enum', id, name, values: ['value_1'] }
          : { kind: 'domain', id, name, base: { kind: 'text' } }
      set({ schema: core.addType(schema, type) })
      return id
    },

    updateType: (type) => set({ schema: core.updateType(get().schema, type) }),

    removeType: (typeId) => {
      const usages = core.typeUsages(get().schema, typeId)
      if (usages.length > 0) return usages
      set({ schema: core.removeType(get().schema, typeId) })
      return []
    },
```

- [ ] **Step 4: Run the web unit tests and lint**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint:fix >/dev/null; pnpm --filter @forge/web test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): store actions for table comments, indexes and user types

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Inspector: column type, default and comment

**Files:**
- Modify: `apps/web/src/components/inspector/inspector.tsx`
- Modify: `apps/web/src/styles.css`
- Test: covered by the pure helpers (Task 5) and by the e2e specs of Task 11; this task is verified by typecheck, lint and a manual-equivalent e2e run of the existing suite.

**Interfaces:**
- Consumes: Task 5 helpers, Task 6 nothing yet, `state.schema.types`.
- Produces: in each column row, aria-labelled controls the e2e specs rely on: `Column type` (select; options by kind, plus an optgroup `Custom types` whose values are `user:<typeId>`), `Array` (checkbox), `Column default` (text), `Column comment` (text), and the existing `Auto-generate`.

- [ ] **Step 1: Edit `ColumnRow`**

Imports: add `choiceOf`, `baseType`, `kindLabel`, `mapBase`, `typeFromChoice`, `withArray` from `lib/column-types.ts` (keep `COLUMN_KINDS`, `setNumericPrecision`, `setNumericScale`, `setVarcharLength`); remove the `ColumnKind` type import if unused.

Inside `ColumnRow`, before `return`, add `const userTypes = useForgeStore((state) => state.schema.types) ?? []` and `const base = baseType(column.type)`.

Replace the type `<select>` with:

```tsx
      <select
        aria-label='Column type'
        value={choiceOf(column.type)}
        onChange={(event) =>
          updateColumn(
            table.id,
            column.id,
            typeChangePatch(
              column,
              typeFromChoice(event.target.value, column.type.kind === 'array')
            )
          )
        }>
        {COLUMN_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kindLabel(kind)}
          </option>
        ))}
        {userTypes.length > 0 && (
          <optgroup label='Custom types'>
            {userTypes.map((type) => (
              <option key={type.id} value={`user:${type.id}`}>
                {type.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <label>
        <input
          type='checkbox'
          aria-label='Array'
          checked={column.type.kind === 'array'}
          onChange={(event) =>
            updateColumn(
              table.id,
              column.id,
              typeChangePatch(column, withArray(column.type, event.target.checked))
            )
          }
        />
        []
      </label>
```

Change the length and precision/scale editors to look at `base` and to rewrap: `{base.kind === 'varchar' && <NumberField … value={base.length} onCommit={(length) => updateColumn(table.id, column.id, { type: mapBase(column.type, (b) => setVarcharLength(b, length)) })} />}`, and the same for numeric (`base.precision`, `base.scale`, `mapBase(column.type, (b) => setNumericPrecision(b, precision))`, `max={base.precision}` for scale). Add a `char` length editor the same way as varchar (`base.kind === 'char'`, label `Length`, `{ kind: 'char', length }` built with `mapBase(column.type, () => ({ kind: 'char', length }))`, min 1, max `MAX_VARCHAR_LENGTH`).

Change the `Auto-generate` handler so that turning it on clears the default, keeping the two exclusive:

```tsx
            onChange={(event) =>
              updateColumn(table.id, column.id, {
                generated: event.target.checked,
                ...(event.target.checked ? { default: '' } : {}),
              })
            }
```

After the Auto-generate label and before the remove button, add a second line for the two text fields:

```tsx
      <div className='column-row__extra'>
        <input
          aria-label='Column default'
          placeholder='default (SQL expression)'
          value={column.default ?? ''}
          disabled={column.generated === true}
          onChange={(event) =>
            updateColumn(table.id, column.id, { default: event.target.value })
          }
        />
        <input
          aria-label='Column comment'
          placeholder='comment'
          value={column.comment ?? ''}
          onChange={(event) =>
            updateColumn(table.id, column.id, { comment: event.target.value })
          }
        />
      </div>
```

Pass the remove `×` button as before. In `styles.css` make the row wrap and style the extra line (check the current `.column-row` rule first and extend it, do not duplicate): `.column-row { flex-wrap: wrap; }` and

```css
.column-row__extra {
  display: flex;
  flex: 1 0 100%;
  gap: 6px;
}

.column-row__extra input {
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 2: Verify**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint:fix >/dev/null; pnpm lint 2>&1 | tail -2; pnpm typecheck 2>&1 | grep -iE "error" | head`
Expected: lint clean. Typecheck may still flag `table-node.tsx` (`formatColumnType` is fine) and `ddl-panel.tsx` (`statement.tableId`); those are fixed in Task 10. Any error in `inspector.tsx` must be fixed now. Then run `pnpm e2e 2>&1 | grep -E "passed|failed"`: the existing suite must pass (the helper selects the type by option value, which is unchanged).

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): Inspector edits a column's default, comment, array and custom type

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Inspector: table comment and indexes

**Files:**
- Create: `apps/web/src/components/inspector/index-list.tsx`
- Modify: `apps/web/src/components/inspector/inspector.tsx`, `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 6 store actions, `INDEX_METHODS`, `ConfirmButton` (props `label`, `armedLabel`, `onConfirm`).
- Produces aria-labels for the e2e: `Table comment`, button `Add index`, per index `Index name`, a `Index columns` group of checkboxes labelled by column name, `Index unique`, `Index method`, and a `ConfirmButton` `Remove index` that arms to `Click again to delete`.

- [ ] **Step 1: Create `index-list.tsx`**

```tsx
import type { Index, Table } from '@forge/core'
import { INDEX_METHODS } from '@forge/core'

import { forgeStore } from '../../hooks/use-forge-store.ts'
import { ConfirmButton } from '../confirm-button.tsx'

function IndexRow({ table, index }: { table: Table; index: Index }) {
  const { updateIndex, removeIndex } = forgeStore.getState()
  const toggle = (columnId: string, on: boolean) =>
    updateIndex(table.id, index.id, {
      columns: on
        ? [...index.columns, columnId]
        : index.columns.filter((id) => id !== columnId),
    })

  return (
    <li className='index-row'>
      <input
        aria-label='Index name'
        value={index.name}
        onChange={(event) =>
          updateIndex(table.id, index.id, { name: event.target.value })
        }
      />
      <fieldset className='index-row__columns'>
        <legend>Index columns</legend>
        {table.columns.map((column) => (
          <label key={column.id}>
            <input
              type='checkbox'
              checked={index.columns.includes(column.id)}
              onChange={(event) => toggle(column.id, event.target.checked)}
            />
            {column.name || '(unnamed)'}
          </label>
        ))}
      </fieldset>
      <label>
        <input
          type='checkbox'
          aria-label='Index unique'
          checked={index.unique}
          onChange={(event) =>
            updateIndex(table.id, index.id, { unique: event.target.checked })
          }
        />
        Unique
      </label>
      <select
        aria-label='Index method'
        value={index.method}
        onChange={(event) =>
          updateIndex(table.id, index.id, {
            method: event.target.value as Index['method'],
          })
        }>
        {INDEX_METHODS.map((method) => (
          <option key={method} value={method}>
            {method}
          </option>
        ))}
      </select>
      <ConfirmButton
        label='Remove index'
        armedLabel='Click again to delete'
        onConfirm={() => removeIndex(table.id, index.id)}
      />
    </li>
  )
}

export function IndexList({ table }: { table: Table }) {
  const indexes = table.indexes ?? []
  return (
    <>
      <h2 className='inspector__heading'>Indexes</h2>
      {indexes.length === 0 && (
        <p className='inspector__hint'>No indexes on this table.</p>
      )}
      <ul className='column-list'>
        {indexes.map((index) => (
          <IndexRow key={index.id} table={table} index={index} />
        ))}
      </ul>
      <button
        type='button'
        disabled={table.columns.length === 0}
        onClick={() => forgeStore.getState().addIndex(table.id)}>
        Add index
      </button>
    </>
  )
}
```

- [ ] **Step 2: Wire it into the Inspector**

In `inspector.tsx` import `IndexList` and destructure `setTableComment` with the other actions. After the `Table name` label add:

```tsx
      <label className='field'>
        Table comment
        <input
          aria-label='Table comment'
          value={table.comment ?? ''}
          onChange={(event) => setTableComment(table.id, event.target.value)}
        />
      </label>
```

Render `<IndexList table={table} />` between the Columns list and the `Relationships` heading. Add CSS:

```css
.index-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
}

.index-row__columns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 2px 6px;
  border: 1px solid var(--border);
}
```

- [ ] **Step 3: Verify and commit**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint:fix >/dev/null; pnpm lint 2>&1 | tail -2; pnpm typecheck 2>&1 | grep -E "inspector|index-list"`
Expected: lint clean; no typecheck error in these two files.

```bash
git add apps/web
git commit -m "feat(web): Inspector edits the table comment and its indexes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Inspector: the Types section

**Files:**
- Create: `apps/web/src/components/inspector/types-panel.tsx`
- Modify: `apps/web/src/components/inspector/inspector.tsx`, `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 6 `addType`, `updateType`, `removeType`; `typeUsages`, `COLUMN_KINDS`, `kindLabel`, `typeFromChoice`, `choiceOf`, `ConfirmButton`.
- Produces: shown when no table is selected: heading `Types`; buttons `Add enum` and `Add domain`; per type `Type name`; an enum has `Enum values` (a textarea, one value per line); a domain has `Domain base type` (select, same values as `Column type` but without arrays and without itself), `Domain not null` (checkbox) and `Domain default`; a `ConfirmButton` `Remove type`, disabled while the type is used, with the line `Used by: <table>.<column>, …` shown next to it.

- [ ] **Step 1: Create `types-panel.tsx`**

```tsx
import type { Schema, UserType } from '@forge/core'
import { typeUsages } from '@forge/core'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import {
  choiceOf,
  COLUMN_KINDS,
  kindLabel,
  typeFromChoice,
} from '../../lib/column-types.ts'
import { ConfirmButton } from '../confirm-button.tsx'

/** Where a type is used, in words: `users.status`, or the domain's name. */
function describeUsages(schema: Schema, typeId: string): string[] {
  return typeUsages(schema, typeId).map((usage) => {
    if (usage.kind === 'domain') {
      return schema.types?.find((type) => type.id === usage.typeId)?.name ?? '?'
    }
    const table = schema.tables.find((candidate) => candidate.id === usage.tableId)
    const column = table?.columns.find((candidate) => candidate.id === usage.columnId)
    return `${table?.name ?? '?'}.${column?.name ?? '?'}`
  })
}

function TypeRow({ type, schema }: { type: UserType; schema: Schema }) {
  const { updateType, removeType } = forgeStore.getState()
  const usedBy = describeUsages(schema, type.id)
  const others = (schema.types ?? []).filter((other) => other.id !== type.id)

  return (
    <li className='type-row'>
      <input
        aria-label='Type name'
        value={type.name}
        onChange={(event) => updateType({ ...type, name: event.target.value })}
      />
      <span className='type-row__kind'>{type.kind}</span>
      {type.kind === 'enum' ? (
        <textarea
          aria-label='Enum values'
          rows={Math.max(2, type.values.length)}
          value={type.values.join('\n')}
          onChange={(event) =>
            updateType({ ...type, values: event.target.value.split('\n') })
          }
        />
      ) : (
        <>
          <select
            aria-label='Domain base type'
            value={choiceOf(type.base)}
            onChange={(event) =>
              updateType({ ...type, base: typeFromChoice(event.target.value, false) })
            }>
            {COLUMN_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabel(kind)}
              </option>
            ))}
            {others.length > 0 && (
              <optgroup label='Custom types'>
                {others.map((other) => (
                  <option key={other.id} value={`user:${other.id}`}>
                    {other.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <label>
            <input
              type='checkbox'
              aria-label='Domain not null'
              checked={type.notNull === true}
              onChange={(event) =>
                updateType({ ...type, notNull: event.target.checked })
              }
            />
            NOT NULL
          </label>
          <input
            aria-label='Domain default'
            placeholder='default (SQL expression)'
            value={type.default ?? ''}
            onChange={(event) =>
              updateType({ ...type, default: event.target.value })
            }
          />
        </>
      )}
      {usedBy.length > 0 ? (
        <p className='inspector__hint'>Used by: {usedBy.join(', ')}</p>
      ) : (
        <ConfirmButton
          label='Remove type'
          armedLabel='Click again to delete'
          onConfirm={() => removeType(type.id)}
        />
      )}
    </li>
  )
}

export function TypesPanel() {
  const schema = useForgeStore((state) => state.schema)
  const types = schema.types ?? []
  return (
    <>
      <h2 className='inspector__heading'>Types</h2>
      {types.length === 0 && (
        <p className='inspector__hint'>
          No custom types. An enum lists its values; a domain narrows a base
          type.
        </p>
      )}
      <ul className='column-list'>
        {types.map((type) => (
          <TypeRow key={type.id} type={type} schema={schema} />
        ))}
      </ul>
      <button type='button' onClick={() => forgeStore.getState().addType('enum')}>
        Add enum
      </button>
      <button type='button' onClick={() => forgeStore.getState().addType('domain')}>
        Add domain
      </button>
    </>
  )
}
```

Because the `Remove type` button only exists while the type is unused, "blocked while in use" is shown as the `Used by:` line instead of a disabled button; the store action still refuses (Task 6) as a second line of defence.

- [ ] **Step 2: Wire it and style**

In `inspector.tsx`, in the `!table` branch, render `<TypesPanel />` after the hint paragraph. CSS:

```css
.type-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
}

.type-row textarea {
  flex: 1 0 100%;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

.type-row__kind {
  color: var(--muted);
  font-size: 11px;
}
```

- [ ] **Step 3: Verify and commit**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint:fix >/dev/null; pnpm lint 2>&1 | tail -2; pnpm typecheck 2>&1 | grep -E "inspector|types-panel"`
Expected: clean for these files.

```bash
git add apps/web
git commit -m "feat(web): Inspector lists, edits and removes custom enum and domain types

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Canvas comment icon, UQ badge, type names; DDL panel statements

**Files:**
- Create: `apps/web/src/components/canvas/comment-icon.tsx`
- Modify: `apps/web/src/components/canvas/table-node.tsx`, `apps/web/src/components/ddl/ddl-panel.tsx`, `apps/web/src/styles.css`
- Test: unit test for the pure part (`hasComment`), e2e in Task 11.
- Create (test): `apps/web/src/tests/unit/lib/comments.test.ts`; Create: `apps/web/src/lib/comments.ts`

**Interfaces:**
- Consumes: `formatColumnType(type, userTypeName)`, `DdlStatement` (Task 4).
- Produces: `hasComment(text: string | undefined): text is string` (true for non-blank text); `CommentIcon({ text, label })` (a `button.comment-icon` with `aria-label={label}`, a quick tooltip `div[role=tooltip].comment-tooltip` rendered in `document.body` on hover and focus); a `UQ` badge (`span.table-node__badge`) on a column that has a single-column unique index; the type cell shows user type names and `[]`.

- [ ] **Step 1: Write the failing test**

`comments.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hasComment } from '../../../lib/comments.ts'

describe('hasComment', () => {
  it('is true only for text that is not blank', () => {
    assert.equal(hasComment('Login address'), true)
    assert.equal(hasComment(''), false)
    assert.equal(hasComment('   '), false)
    assert.equal(hasComment(undefined), false)
  })
})
```

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/web && node --test src/tests/unit/lib/comments.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE"`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement**

`lib/comments.ts`:

```ts
/** A comment that is empty or only spaces counts as none, in the UI and the DDL. */
export function hasComment(text: string | undefined): text is string {
  return text !== undefined && text.trim() !== ''
}
```

`comment-icon.tsx`:

```tsx
import { useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small mark that shows a comment on hover or focus. The tooltip is drawn in
 * the page body, not inside the table node, so no other table can cover it and
 * it never changes the fixed size of the node.
 */
export function CommentIcon({ text, label }: { text: string; label: string }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const show = (element: HTMLElement) => {
    const box = element.getBoundingClientRect()
    setAnchor({ x: box.left + box.width / 2, y: box.bottom + 6 })
  }

  return (
    <>
      <button
        type='button'
        className='comment-icon nodrag nopan'
        aria-label={label}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={() => setAnchor(null)}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setAnchor(null)}>
        <span aria-hidden='true'>i</span>
      </button>
      {anchor &&
        createPortal(
          <div
            role='tooltip'
            className='comment-tooltip'
            style={{ left: anchor.x, top: anchor.y }}>
            {text}
          </div>,
          document.body
        )}
    </>
  )
}
```

`table-node.tsx`: import `CommentIcon`, `hasComment`; read `const userTypes = useForgeStore((state) => state.schema.types)`; define `const typeName = (typeId: string) => userTypes?.find((type) => type.id === typeId)?.name ?? '?'`. Make the title `<div className='table-node__title'><span className='table-node__title-text'>{table.name || '(unnamed)'}</span>{hasComment(table.comment) && <CommentIcon text={table.comment} label='Table comment' />}</div>`. In each column `li`, after the `table-node__name` span add `{hasComment(column.comment) && <CommentIcon text={column.comment} label='Column comment' />}` and, before the PK badge, a UQ badge:

```tsx
            {table.indexes?.some(
              (index) =>
                index.unique &&
                index.columns.length === 1 &&
                index.columns[0] === column.id
            ) && <span className='table-node__badge'>UQ</span>}
```

Change the type cell to `{formatColumnType(column.type, typeName)}`. The icon's `label` is the accessible name only; the tooltip text is the comment.

`ddl-panel.tsx`: statements now come in four kinds and `type` has no table. Replace the per-statement computations: `const tableId = 'tableId' in statement ? statement.tableId : null`, `const active = tableId !== null && tableId === hoveredTable`; use `active` for the `ddl-active` class and for the `ref` (only on `statement.kind === 'create'`); `data-table={tableId ?? undefined}` and add `data-type={statement.kind === 'type' ? statement.typeId : undefined}`; `onMouseEnter` calls `hoverTable(tableId)` only when `tableId !== null`, and `onMouseLeave` keeps clearing. Type statements therefore light up nothing on the canvas.

CSS: the title becomes a flex row and the two new pieces are styled:

```css
.table-node__title {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: normal;
  overflow: visible;
}

.table-node__title-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.table-node__type {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.comment-icon {
  flex: none;
  width: 14px;
  height: 14px;
  padding: 0;
  font-size: 10px;
  font-style: italic;
  line-height: 12px;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 50%;
  cursor: help;
}

.comment-tooltip {
  position: fixed;
  z-index: 1000;
  max-width: 320px;
  padding: 6px 8px;
  font-size: 12px;
  white-space: pre-wrap;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
  transform: translateX(-50%);
  pointer-events: none;
}
```

Merge the title rules into the existing `.table-node__title` and `.table-node__type` rules instead of duplicating them (keep `box-sizing: border-box`, `height: 31px`, `padding: 0 10px`, `font-weight: 600`, `border-bottom`). Remove the old `line-height: 30px` there; the flex row centres the content inside the fixed 31 px.

- [ ] **Step 3: Verify**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint:fix >/dev/null; pnpm lint 2>&1 | tail -2; pnpm typecheck 2>&1 | grep -ciE "error"; pnpm test 2>&1 | grep -E "ℹ fail"; pnpm e2e 2>&1 | grep -E "passed|failed"`
Expected: lint clean, 0 typecheck errors, all unit tests pass, the whole existing e2e suite passes (the geometry spec still sees width 220 and height `33 + 26 × rows`).

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): comment icon with hover tooltip, UQ badge, type names on the canvas; DDL panel handles the new statements

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Example, e2e, docs and the final gate

**Files:**
- Modify: `apps/web/src/lib/example/shop-example.ts`, `apps/web/src/tests/unit/lib/example/shop-example.test.ts`
- Create: `apps/e2e/tests/model-additions.spec.ts`
- Create: `packages/core/docs/adr/0007-indexes-comments-defaults-and-user-types.md`
- Modify: `packages/core/GLOSSARY.md`, `apps/web/GLOSSARY.md`

**Interfaces:**
- Consumes: everything above.
- Produces: an example that shows the new features; e2e coverage; docs.

- [ ] **Step 1: Write the failing example test**

Append to `shop-example.test.ts` (inside the `describe`, using its existing `schema`; import `validate` from `@forge/core` if not already imported):

```ts
  it('shows the model additions: an enum, an index, comments and a default, and stays valid', () => {
    assert.deepEqual(validate(schema), [])
    assert.ok((schema.types ?? []).some((type) => type.kind === 'enum'))
    assert.ok(schema.tables.some((table) => (table.indexes ?? []).length > 0))
    assert.ok(schema.tables.some((table) => table.comment))
    const columns = schema.tables.flatMap((table) => table.columns)
    assert.ok(columns.some((column) => column.comment))
    assert.ok(columns.some((column) => column.default))
    assert.ok(columns.some((column) => column.type.kind === 'user'))
  })
```

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/web && node --test src/tests/unit/lib/example/shop-example.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL.

- [ ] **Step 2: Extend the example**

In `shop-example.ts`: add `comment?: string` and `default?: string` to `ColumnDef`; `comment?: string` and `indexes?: { name: string; columns: string[]; unique?: boolean }[]` to `TableDef`; a `TYPES` list and ids:

```ts
const ORDER_STATUS_ID = 'ex-ty-order_status'
const orderStatus: ColumnType = { kind: 'user', typeId: ORDER_STATUS_ID }
```

Data changes: `users` gets `comment: 'People who can place orders'`, `email` gets `comment: 'Login address, unique'`, and `indexes: [{ name: 'uq_users_email', columns: ['email'], unique: true }]`; `orders` gets `status` as `{ name: 'status', type: orderStatus, notNull: true, default: "'pending'" }` (replacing the `varchar(20)`), `total` gets `comment: 'Sum of the items, in the shop currency'`, and `indexes: [{ name: 'idx_orders_user_id', columns: ['user_id'] }, { name: 'idx_orders_created_at', columns: ['created_at'] }]`. In `createShopExample`, before the tables loop add the enum with `core.addType(schema, { kind: 'enum', id: ORDER_STATUS_ID, name: 'order_status', values: ['pending', 'paid', 'shipped', 'cancelled'] })`; in the column loop pass `...(column.comment ? { comment: column.comment } : {})` and `...(column.default ? { default: column.default } : {})`; after the columns of a table, `if (table.comment) schema = core.setTableComment(schema, tableId(table.name), table.comment)` and, for each declared index, `core.addIndex(schema, tableId(table.name), { id: \`ex-i-${index.name}\`, name: index.name, columns: index.columns.map((name) => columnId(table.name, name)), unique: index.unique ?? false, method: 'btree' })`.

Run the unit test again: expect PASS, then `pnpm --filter @forge/web test` and fix any existing example test that pinned `orders.status` as varchar (replace with the user type).

- [ ] **Step 3: Write the e2e spec**

`apps/e2e/tests/model-additions.spec.ts`:

```ts
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

async function exampleLoaded(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 })
  const editor = new Editor(page)
  await editor.open()
  await page.getByRole('button', { name: 'Load example' }).click()
  await expect(editor.tables()).toHaveCount(7)
  return editor
}

test.describe('comments, indexes, defaults and types', () => {
  test('a commented column shows an icon, and hovering it shows the comment', async ({ page }) => {
    const editor = await exampleLoaded(page)
    const row = editor
      .node('users')
      .locator('.table-node__column', { hasText: 'email' })
    await row.getByRole('button', { name: 'Column comment' }).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Login address, unique')
    await page.mouse.move(5, 300)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  })

  test('a commented table shows the icon in its title', async ({ page }) => {
    const editor = await exampleLoaded(page)
    await editor.node('users').getByRole('button', { name: 'Table comment' }).hover()
    await expect(page.getByRole('tooltip')).toHaveText('People who can place orders')
  })

  test('the node keeps its fixed size with comments and a UQ badge', async ({ page }) => {
    const editor = await exampleLoaded(page)
    const size = await editor
      .node('users')
      .locator('.table-node')
      .evaluate((element) => ({
        w: (element as HTMLElement).offsetWidth,
        h: (element as HTMLElement).offsetHeight,
        rows: element.querySelectorAll('.table-node__column').length,
      }))
    expect(size.w).toBe(220)
    expect(size.h).toBe(33 + 26 * size.rows)
    await expect(
      editor.node('users').locator('.table-node__badge', { hasText: 'UQ' })
    ).toHaveCount(1)
  })

  test('the Inspector sets a table comment, and the DDL gets COMMENT ON', async ({ page }) => {
    const editor = await exampleLoaded(page)
    await editor.selectTable('categories')
    await page.getByLabel('Table comment').fill('Product groups')
    await expect(editor.node('categories').getByRole('button', { name: 'Table comment' })).toBeVisible()
    expect(await editor.ddl()).toContain(`COMMENT ON TABLE "categories" IS 'Product groups';`)
  })

  test('adding an index from the Inspector puts CREATE INDEX in the DDL, and it can be made unique and removed', async ({ page }) => {
    const editor = await exampleLoaded(page)
    await editor.selectTable('categories')
    await page.getByRole('button', { name: 'Add index' }).click()
    expect(await editor.ddl()).toContain('CREATE INDEX "idx_categories_id" ON "categories" ("id");')

    await page.getByLabel('Index unique').check()
    expect(await editor.ddl()).toContain('CREATE UNIQUE INDEX "idx_categories_id" ON "categories" ("id");')

    await page.getByRole('button', { name: 'Remove index' }).click()
    await page.getByRole('button', { name: 'Click again to delete' }).click()
    expect(await editor.ddl()).not.toContain('idx_categories_id')
  })

  test('hovering a table also lights its CREATE INDEX statement', async ({ page }) => {
    const editor = await exampleLoaded(page)
    await editor.showDdl()
    await editor.node('orders').locator('.table-node__title').hover()
    const active = page.locator('.ddl-active')
    await expect(active.filter({ hasText: 'CREATE INDEX "idx_orders_user_id"' })).toHaveCount(1)
  })

  test('a default and Auto-generate exclude each other', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('items', [{ name: 'qty', type: 'integer' }])
    await page.getByLabel('Column default').fill('0')
    expect(await editor.ddl()).toContain('"qty" integer DEFAULT 0')

    await page.getByLabel('Auto-generate').check()
    await expect(page.getByLabel('Column default')).toBeDisabled()
    await expect(page.getByLabel('Column default')).toHaveValue('')
  })

  test('an enum is created, used by a column, listed as in use, and written to the DDL', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('tickets', [{ name: 'mood', type: 'text' }])
    await page.mouse.click(700, 400)
    await page.getByRole('button', { name: 'Add enum' }).click()
    await page.getByLabel('Type name').fill('mood_kind')
    await page.getByLabel('Enum values').fill('happy\nsad')

    await editor.selectTable('tickets')
    await page.getByLabel('Column type').selectOption({ label: 'mood_kind' })
    const sql = await editor.ddl()
    expect(sql).toContain(`CREATE TYPE "mood_kind" AS ENUM ('happy', 'sad');`)
    expect(sql).toContain('"mood" "mood_kind"')
    expect(sql.indexOf('CREATE TYPE')).toBeLessThan(sql.indexOf('CREATE TABLE'))

    await page.getByLabel('Array').check()
    expect(await editor.ddl()).toContain('"mood" "mood_kind"[]')

    await page.mouse.click(700, 400)
    await expect(page.getByText('Used by: tickets.mood')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove type' })).toHaveCount(0)
  })
})
```

Adjust selectors to the real Editor helpers if they differ (`defineTable` leaves the new table selected; if it does not, call `editor.selectTable` first; clicking the pane at `(700, 400)` clears the selection so the Types section shows). Run it and iterate until green; do not weaken an assertion to pass.

- [ ] **Step 4: Docs**

`packages/core/docs/adr/0007-indexes-comments-defaults-and-user-types.md`: status accepted; context (the SQL import needs somewhere to put what it reads); decision (optional fields, `Index`, `UserType`, raw `default`, comments, the new kinds, `timestamp_no_tz`, no `jsonb`/`serial` kinds, DDL order, `DdlStatement` kinds); consequences (partial or expression indexes, `CHECK` and composite types are not modelled; relationship type check compares shape). Add to `packages/core/GLOSSARY.md`: **Index**, **User type** (enum, domain), **Default** (raw expression, exclusive with Generated), **Comment**. Add to `apps/web/GLOSSARY.md`: **Comment icon** (what it shows and where), **Types section** (the Inspector with no table selected), **UQ badge**.

- [ ] **Step 5: Final gate**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint && pnpm typecheck && pnpm test 2>&1 | grep -E "ℹ (tests|pass|fail)" && pnpm build 2>&1 | tail -2 && pnpm e2e 2>&1 | grep -E "passed|failed"`
Expected: all green. Take a screenshot of the example with a comment tooltip open and look at it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: the example shows the model additions; e2e, ADR and glossary for them

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
