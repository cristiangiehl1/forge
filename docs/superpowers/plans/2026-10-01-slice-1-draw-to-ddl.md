# Slice 1: Draw Tables, Generate PostgreSQL DDL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user draws tables, columns and foreign keys on a canvas, sees the generated PostgreSQL DDL, and finds the project restored after a reload.

**Architecture:** `@forge/core` holds an immutable `Schema`, pure edit operations, validation, a PostgreSQL dialect, a DDL generator and the saved-project envelope; it has no platform dependency. `@forge/web` keeps a vanilla Zustand store (schema + view + selection), projects it into React Flow nodes and edges, edits through a side inspector, and persists to `localStorage` through plain load/save functions wrapped by TanStack Query hooks.

**Tech Stack:** TypeScript 7, Node 24 `node:test` (type-stripping), pnpm workspace, Vite 8 + React 19 + React Compiler, React Flow (`@xyflow/react`), Zustand 5, TanStack Router, TanStack Query, Biome.

**Spec:** `docs/superpowers/specs/2026-10-01-slice-1-draw-to-ddl-design.md` (read it together with this plan). Decisions live in `packages/core/docs/adr/`, `apps/web/docs/adr/` and `docs/adr/`.

## Global Constraints

- `@forge/core` is platform-free: no DOM lib, no `window`, `fetch`, `crypto` or Node globals in `src/` outside `src/tests/`. Enforced by `packages/core/tsconfig.json` (`lib: ["ES2023"]`, `types: []`). IDs are strings supplied by the caller.
- Only the PostgreSQL dialect exists in this slice; identifiers are always double-quoted with `"` escaped as `""`.
- Relative imports must include the `.ts` extension (tests run with `node --test` type-stripping, and `allowImportingTsExtensions` is on). No enums and no constructor parameter properties (`erasableSyntaxOnly`). Use `import type` / `export type` for types (`verbatimModuleSyntax`).
- Style is Biome: single quotes, JSX single quotes, no semicolons, `trailingCommas: es5`, 80 columns. Run `pnpm lint:fix` before every commit; `pnpm lint` must be clean.
- Tests: `node:test` + `node:assert/strict`, centralized in `src/tests/{unit,integration}`; `unit/` mirrors the `src/` path of the file under test; `integration/<area>/` has one file per flow or action. No component-rendering tests, no end-to-end tests, no Vitest/Jest/Testing Library.
- `apps/web`: no hand-written `useMemo`, `useCallback` or `React.memo` (React Compiler is on); a table node's `data` holds only the table id; the Zustand store is the only owner of canvas state and updates are immutable and minimal; the React Flow attribution link stays visible.
- Vocabulary: `Schema`, `Table`, `Column`, `Relationship` belong to `@forge/core`; `Node`, `Viewport`, `Selection` belong to `apps/web`. A table node references a table by id and holds no schema data.
- Out of scope: SQL parser, other dialects, `UNIQUE`/`DEFAULT`/indexes, composite foreign keys, undo/redo, multiple projects, file import/export, auto layout, `apps/api`, authentication.
- One project, stored in `localStorage` under the key `forge:project`.
- **Run every command with Node 24 from mise.** The system Node 22 on this machine cannot run `.ts` files (`ERR_UNKNOWN_FILE_EXTENSION`, verified), so every `node --test` fails on it. Start each shell session with `export PATH="$(mise where node)/bin:$PATH"` and check that `node -v` prints `v24.21.0` before running anything else.
- Commits: Conventional Commits in English, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Inputs and conditions the spec implies but no acceptance criterion exercises, most likely first. Each has a pinning test in the task named in brackets.

1. **Hostile names**: a table or column name containing `"`, uppercase letters, spaces, or non-ASCII characters must be quoted and escaped, never break the statement. [Task 4, golden test "quotes and escapes names"]
2. **Degenerate schemas**: an empty schema generates an empty string; a table with no columns generates `CREATE TABLE "t" ();`; a table without a primary key generates no `PRIMARY KEY` clause; primary-key columns are `NOT NULL` even when the column says nullable. [Task 4]
3. **Self-referencing and circular foreign keys** (`employees.manager_id` → `employees.id`; `a.b_id` ↔ `b.a_id`) must generate valid SQL: every `ALTER TABLE` comes after every `CREATE TABLE`. [Task 4]
4. **Long identifiers**: a derived constraint name over 63 bytes (including multi-byte characters) is truncated by bytes, and two foreign keys whose truncated names collide get distinct names. [Task 4, unit test of `constraint-names` and golden test "long names"]
5. **Hostile or stale stored data**: `localStorage` that throws on read or write (private mode, quota exceeded), JSON that is not JSON, JSON from another app, a `formatVersion` written by a newer app, and a relationship pointing at a deleted table must be reported and must never overwrite what is stored. [Task 5 for `parseProject`, Task 7 for load/save]

Operations called with ids that no longer exist (a UI race after a deletion) return the schema unchanged. [Task 1]

---

### Task 1: Core — schema types and edit operations

**Files:**
- Create: `packages/core/src/schema/types.ts`
- Create: `packages/core/src/schema/operations.ts`
- Create: `packages/core/src/tests/helpers/schema-builders.ts`
- Create: `packages/core/src/tests/helpers/fixtures.ts`
- Test: `packages/core/src/tests/unit/schema/operations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`schema/types.ts`):
  - `TableId`, `ColumnId`, `RelationshipId` (all `string`)
  - `SIMPLE_COLUMN_KINDS` (`readonly` tuple), `SimpleColumnKind`, `MAX_VARCHAR_LENGTH` (10485760), `MAX_NUMERIC_PRECISION` (1000)
  - `ColumnType = { kind: SimpleColumnKind } | { kind: 'varchar'; length: number } | { kind: 'numeric'; precision: number; scale: number }`
  - `Column { id; name; type: ColumnType; nullable: boolean }`
  - `Table { id; name; columns: Column[]; primaryKey: ColumnId[] }`
  - `ColumnRef { tableId; columnId }`, `Relationship { id; from: ColumnRef; to: ColumnRef }`
  - `Schema { version: 1; tables: Table[]; relationships: Relationship[] }`
- Produces (`schema/operations.ts`), every function pure, returns the same `Schema` object when the ids do not exist:
  - `createSchema(): Schema`
  - `addTable(schema, table: { id: TableId; name: string }): Schema`
  - `renameTable(schema, tableId, name): Schema`
  - `removeTable(schema, tableId): Schema`
  - `addColumn(schema, tableId, column: Column): Schema`
  - `updateColumn(schema, tableId, columnId, patch: Partial<Omit<Column, 'id'>>): Schema`
  - `removeColumn(schema, tableId, columnId): Schema`
  - `setPrimaryKey(schema, tableId, columnIds: ColumnId[]): Schema`
  - `addRelationship(schema, relationship: Relationship): Schema`
  - `removeRelationship(schema, relationshipId): Schema`
- Produces (test helpers): `column(id, name, type?, nullable?)`, `table(id, name, columns?, primaryKey?)`, `schemaOf(tables, relationships?)`, `deepFreeze(value)`, and the frozen fixtures `usersTable`, `ordersTable`, `ordersToUsers`, `usersOrders`.

- [ ] **Step 1: Create the work branch**

```bash
git switch -c feat/slice-1-draw-to-ddl
```

- [ ] **Step 2: Write the types**

Create `packages/core/src/schema/types.ts`:

```ts
export type TableId = string
export type ColumnId = string
export type RelationshipId = string

export const SIMPLE_COLUMN_KINDS = [
  'integer',
  'bigint',
  'text',
  'boolean',
  'uuid',
  'timestamp',
  'date',
  'json',
] as const

export type SimpleColumnKind = (typeof SIMPLE_COLUMN_KINDS)[number]

// PostgreSQL limits: varchar(n) up to 10485760, numeric precision up to 1000.
// They live here so the parser and every UI that edits a type share one value.
export const MAX_VARCHAR_LENGTH = 10_485_760
export const MAX_NUMERIC_PRECISION = 1000

export type ColumnType =
  | { kind: SimpleColumnKind }
  | { kind: 'varchar'; length: number }
  | { kind: 'numeric'; precision: number; scale: number }

export interface Column {
  id: ColumnId
  name: string
  type: ColumnType
  nullable: boolean
}

export interface Table {
  id: TableId
  name: string
  columns: Column[]
  primaryKey: ColumnId[]
}

export interface ColumnRef {
  tableId: TableId
  columnId: ColumnId
}

/** `from` references `to`; it becomes a FOREIGN KEY. */
export interface Relationship {
  id: RelationshipId
  from: ColumnRef
  to: ColumnRef
}

export interface Schema {
  version: 1
  tables: Table[]
  relationships: Relationship[]
}
```

- [ ] **Step 3: Write the test helpers**

Create `packages/core/src/tests/helpers/schema-builders.ts`:

```ts
import type {
  Column,
  ColumnType,
  Relationship,
  Schema,
  Table,
} from '../../schema/types.ts'

export function column(
  id: string,
  name: string,
  type: ColumnType = { kind: 'text' },
  nullable = true
): Column {
  return { id, name, type, nullable }
}

export function table(
  id: string,
  name: string,
  columns: Column[] = [],
  primaryKey: string[] = []
): Table {
  return { id, name, columns, primaryKey }
}

export function schemaOf(
  tables: Table[],
  relationships: Relationship[] = []
): Schema {
  return { version: 1, tables, relationships }
}

/** Freezes recursively so a mutating operation throws instead of passing. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
```

Create `packages/core/src/tests/helpers/fixtures.ts`:

```ts
import type { Relationship } from '../../schema/types.ts'
import { column, deepFreeze, schemaOf, table } from './schema-builders.ts'

export const usersTable = deepFreeze(
  table(
    'users',
    'users',
    [
      column('u_id', 'id', { kind: 'uuid' }, false),
      column('u_name', 'name', { kind: 'varchar', length: 120 }, false),
    ],
    ['u_id']
  )
)

export const ordersTable = deepFreeze(
  table(
    'orders',
    'orders',
    [
      column('o_id', 'id', { kind: 'uuid' }, false),
      column('o_user', 'user_id', { kind: 'uuid' }, false),
      column('o_total', 'total', { kind: 'numeric', precision: 10, scale: 2 }),
      column('o_created', 'created_at', { kind: 'timestamp' }, false),
    ],
    ['o_id']
  )
)

export const ordersToUsers: Relationship = deepFreeze({
  id: 'fk1',
  from: { tableId: 'orders', columnId: 'o_user' },
  to: { tableId: 'users', columnId: 'u_id' },
})

/** users and orders, with orders.user_id referencing users.id. Deeply frozen. */
export const usersOrders = deepFreeze(
  schemaOf([usersTable, ordersTable], [ordersToUsers])
)
```

- [ ] **Step 4: Write the failing tests**

Create `packages/core/src/tests/unit/schema/operations.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  addColumn,
  addRelationship,
  addTable,
  createSchema,
  removeColumn,
  removeRelationship,
  removeTable,
  renameTable,
  setPrimaryKey,
  updateColumn,
} from '../../../schema/operations.ts'
import {
  ordersToUsers,
  ordersTable,
  usersOrders,
  usersTable,
} from '../../helpers/fixtures.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

describe('createSchema', () => {
  it('returns an empty version 1 schema', () => {
    assert.deepEqual(createSchema(), {
      version: 1,
      tables: [],
      relationships: [],
    })
  })
})

describe('addTable', () => {
  it('appends a table with no columns and no primary key', () => {
    const result = addTable(createSchema(), { id: 't1', name: 'users' })
    assert.deepEqual(result, schemaOf([table('t1', 'users')]))
  })

  it('does not mutate the input schema', () => {
    const before = createSchema()
    const after = addTable(before, { id: 't1', name: 'users' })
    assert.notEqual(before, after)
    assert.deepEqual(before.tables, [])
  })
})

describe('renameTable', () => {
  it('renames only the target table and keeps the others by reference', () => {
    const result = renameTable(usersOrders, 'users', 'people')
    assert.equal(result.tables[0]?.name, 'people')
    assert.equal(result.tables[1], ordersTable)
  })

  it('returns the same schema for an unknown table', () => {
    assert.equal(renameTable(usersOrders, 'nope', 'x'), usersOrders)
  })
})

describe('removeTable', () => {
  it('removes the table and every relationship that touches it', () => {
    const fromSide = removeTable(usersOrders, 'orders')
    assert.deepEqual(fromSide.tables, [usersTable])
    assert.deepEqual(fromSide.relationships, [])

    const toSide = removeTable(usersOrders, 'users')
    assert.deepEqual(toSide.tables, [ordersTable])
    assert.deepEqual(toSide.relationships, [])
  })

  it('returns the same schema for an unknown table', () => {
    assert.equal(removeTable(usersOrders, 'nope'), usersOrders)
  })
})

describe('addColumn', () => {
  it('appends the column to the table', () => {
    const schema = schemaOf([table('t1', 'users')])
    const result = addColumn(schema, 't1', column('c1', 'id'))
    assert.deepEqual(result.tables[0]?.columns, [column('c1', 'id')])
  })

  it('returns the same schema for an unknown table', () => {
    assert.equal(addColumn(usersOrders, 'nope', column('c1', 'x')), usersOrders)
  })
})

describe('updateColumn', () => {
  it('patches name, type and nullable, and keeps the id', () => {
    const result = updateColumn(usersOrders, 'users', 'u_name', {
      name: 'full_name',
      type: { kind: 'text' },
      nullable: true,
    })
    assert.deepEqual(result.tables[0]?.columns[1], {
      id: 'u_name',
      name: 'full_name',
      type: { kind: 'text' },
      nullable: true,
    })
  })

  it('returns the same schema for an unknown table or column', () => {
    assert.equal(updateColumn(usersOrders, 'nope', 'u_id', {}), usersOrders)
    assert.equal(updateColumn(usersOrders, 'users', 'nope', {}), usersOrders)
  })
})

describe('removeColumn', () => {
  it('removes the column, its primary-key entry and its relationships', () => {
    const fromSide = removeColumn(usersOrders, 'orders', 'o_user')
    assert.equal(fromSide.tables[1]?.columns.length, 3)
    assert.deepEqual(fromSide.relationships, [])

    const toSide = removeColumn(usersOrders, 'users', 'u_id')
    assert.deepEqual(toSide.tables[0]?.primaryKey, [])
    assert.deepEqual(toSide.relationships, [])
  })

  it('returns the same schema for an unknown table or column', () => {
    assert.equal(removeColumn(usersOrders, 'nope', 'u_id'), usersOrders)
    assert.equal(removeColumn(usersOrders, 'users', 'nope'), usersOrders)
  })
})

describe('setPrimaryKey', () => {
  it('sets a composite key in the given order', () => {
    const schema = schemaOf([
      table('t', 't', [column('a', 'a'), column('b', 'b')]),
    ])
    const result = setPrimaryKey(schema, 't', ['b', 'a'])
    assert.deepEqual(result.tables[0]?.primaryKey, ['b', 'a'])
  })

  it('drops duplicates and ids that are not columns of the table', () => {
    const result = setPrimaryKey(usersOrders, 'users', ['u_id', 'u_id', 'x'])
    assert.deepEqual(result.tables[0]?.primaryKey, ['u_id'])
  })

  it('clears the key with an empty list', () => {
    const result = setPrimaryKey(usersOrders, 'users', [])
    assert.deepEqual(result.tables[0]?.primaryKey, [])
  })

  it('returns the same schema for an unknown table', () => {
    assert.equal(setPrimaryKey(usersOrders, 'nope', []), usersOrders)
  })
})

describe('addRelationship and removeRelationship', () => {
  it('adds a relationship and removes it by id', () => {
    const schema = schemaOf([usersTable, ordersTable])
    const added = addRelationship(schema, ordersToUsers)
    assert.deepEqual(added.relationships, [ordersToUsers])

    const removed = removeRelationship(added, 'fk1')
    assert.deepEqual(removed.relationships, [])
  })

  it('returns the same schema when the relationship does not exist', () => {
    assert.equal(removeRelationship(usersOrders, 'nope'), usersOrders)
  })
})
```

- [ ] **Step 5: Run the tests and verify they fail**

Run: `cd packages/core && node --test src/tests/unit/schema/operations.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `schema/operations.ts`.

- [ ] **Step 6: Implement the operations**

Create `packages/core/src/schema/operations.ts`:

```ts
import type {
  Column,
  ColumnId,
  Relationship,
  RelationshipId,
  Schema,
  Table,
  TableId,
} from './types.ts'

export function createSchema(): Schema {
  return { version: 1, tables: [], relationships: [] }
}

function findTable(schema: Schema, tableId: TableId): Table | undefined {
  return schema.tables.find((candidate) => candidate.id === tableId)
}

function replaceTable(
  schema: Schema,
  tableId: TableId,
  update: (table: Table) => Table
): Schema {
  return {
    ...schema,
    tables: schema.tables.map((candidate) =>
      candidate.id === tableId ? update(candidate) : candidate
    ),
  }
}

export function addTable(
  schema: Schema,
  table: { id: TableId; name: string }
): Schema {
  const created: Table = {
    id: table.id,
    name: table.name,
    columns: [],
    primaryKey: [],
  }
  return { ...schema, tables: [...schema.tables, created] }
}

export function renameTable(
  schema: Schema,
  tableId: TableId,
  name: string
): Schema {
  if (!findTable(schema, tableId)) return schema
  return replaceTable(schema, tableId, (table) => ({ ...table, name }))
}

export function removeTable(schema: Schema, tableId: TableId): Schema {
  if (!findTable(schema, tableId)) return schema
  return {
    ...schema,
    tables: schema.tables.filter((table) => table.id !== tableId),
    relationships: schema.relationships.filter(
      (relationship) =>
        relationship.from.tableId !== tableId &&
        relationship.to.tableId !== tableId
    ),
  }
}

export function addColumn(
  schema: Schema,
  tableId: TableId,
  column: Column
): Schema {
  if (!findTable(schema, tableId)) return schema
  return replaceTable(schema, tableId, (table) => ({
    ...table,
    columns: [...table.columns, column],
  }))
}

export function updateColumn(
  schema: Schema,
  tableId: TableId,
  columnId: ColumnId,
  patch: Partial<Omit<Column, 'id'>>
): Schema {
  const table = findTable(schema, tableId)
  if (!table?.columns.some((column) => column.id === columnId)) return schema
  return replaceTable(schema, tableId, (current) => ({
    ...current,
    columns: current.columns.map((column) =>
      column.id === columnId ? { ...column, ...patch, id: column.id } : column
    ),
  }))
}

export function removeColumn(
  schema: Schema,
  tableId: TableId,
  columnId: ColumnId
): Schema {
  const table = findTable(schema, tableId)
  if (!table?.columns.some((column) => column.id === columnId)) return schema
  const withoutColumn = replaceTable(schema, tableId, (current) => ({
    ...current,
    columns: current.columns.filter((column) => column.id !== columnId),
    primaryKey: current.primaryKey.filter((id) => id !== columnId),
  }))
  return {
    ...withoutColumn,
    relationships: withoutColumn.relationships.filter(
      (relationship) =>
        !(
          relationship.from.tableId === tableId &&
          relationship.from.columnId === columnId
        ) &&
        !(
          relationship.to.tableId === tableId &&
          relationship.to.columnId === columnId
        )
    ),
  }
}

export function setPrimaryKey(
  schema: Schema,
  tableId: TableId,
  columnIds: ColumnId[]
): Schema {
  const table = findTable(schema, tableId)
  if (!table) return schema
  const primaryKey = [...new Set(columnIds)].filter((id) =>
    table.columns.some((column) => column.id === id)
  )
  return replaceTable(schema, tableId, (current) => ({
    ...current,
    primaryKey,
  }))
}

export function addRelationship(
  schema: Schema,
  relationship: Relationship
): Schema {
  return { ...schema, relationships: [...schema.relationships, relationship] }
}

export function removeRelationship(
  schema: Schema,
  relationshipId: RelationshipId
): Schema {
  if (!schema.relationships.some((r) => r.id === relationshipId)) return schema
  return {
    ...schema,
    relationships: schema.relationships.filter((r) => r.id !== relationshipId),
  }
}
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `cd packages/core && node --test src/tests/unit/schema/operations.test.ts`
Expected: PASS — 19 tests, 0 failures.

- [ ] **Step 8: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm --filter @forge/core typecheck && pnpm --filter @forge/core test
git add packages/core/src
git commit -m "feat(core): add schema types and pure edit operations

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Core — validation and `checkRelationship`

**Files:**
- Create: `packages/core/src/schema/validate.ts`
- Test: `packages/core/src/tests/unit/schema/validate.test.ts`

**Interfaces:**
- Consumes: `Schema`, `ColumnRef`, `Relationship`, `TableId`, `ColumnId`, `RelationshipId` from `schema/types.ts`; test helpers from Task 1.
- Produces (`schema/validate.ts`):
  - `IssueCode` = `'empty-table-name' | 'duplicate-table-name' | 'empty-column-name' | 'duplicate-column-name' | 'multiple-relationships-from-column' | 'relationship-unknown-column' | 'relationship-type-mismatch' | 'relationship-target-not-sole-primary-key'`
  - `Issue { code: IssueCode; message: string; tableId?: TableId; columnId?: ColumnId; relationshipId?: RelationshipId }`
  - `validate(schema: Schema): Issue[]` — never throws; `[]` means valid
  - `checkRelationship(schema: Schema, from: ColumnRef, to: ColumnRef): Issue | null` — the issue adding that relationship would cause, `null` when allowed. A `from` column that already has a relationship in `schema` is an issue.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/tests/unit/schema/validate.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addRelationship } from '../../../schema/operations.ts'
import { checkRelationship, validate } from '../../../schema/validate.ts'
import { ordersToUsers, usersOrders } from '../../helpers/fixtures.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

const codes = (schema: Parameters<typeof validate>[0]) =>
  validate(schema).map((issue) => issue.code)

describe('validate', () => {
  it('accepts a well-formed schema', () => {
    assert.deepEqual(validate(usersOrders), [])
  })

  it('accepts an empty schema', () => {
    assert.deepEqual(validate(schemaOf([])), [])
  })

  it('flags empty and blank table names', () => {
    const schema = schemaOf([table('a', ''), table('b', '   ')])
    assert.deepEqual(codes(schema), ['empty-table-name', 'empty-table-name'])
  })

  it('flags a duplicate table name on the later table, case-sensitively', () => {
    const schema = schemaOf([
      table('a', 'users'),
      table('b', 'users'),
      table('c', 'Users'),
    ])
    const issues = validate(schema)
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.code, 'duplicate-table-name')
    assert.equal(issues[0]?.tableId, 'b')
  })

  it('flags empty and duplicate column names inside one table', () => {
    const schema = schemaOf([
      table('t', 't', [column('c1', 'x'), column('c2', 'x'), column('c3', '')]),
      table('u', 'u', [column('c4', 'x')]),
    ])
    const issues = validate(schema)
    assert.deepEqual(
      issues.map((issue) => [issue.code, issue.columnId]),
      [
        ['duplicate-column-name', 'c2'],
        ['empty-column-name', 'c3'],
      ]
    )
  })

  it('flags both relationships when one column is the source of two', () => {
    const second = { ...ordersToUsers, id: 'fk2' }
    const schema = addRelationship(usersOrders, second)
    const issues = validate(schema).filter(
      (issue) => issue.code === 'multiple-relationships-from-column'
    )
    assert.deepEqual(issues.map((issue) => issue.relationshipId).sort(), [
      'fk1',
      'fk2',
    ])
  })

  it('flags a relationship between columns of different types', () => {
    const schema = schemaOf(
      [
        table('a', 'a', [column('a_id', 'id', { kind: 'uuid' })], ['a_id']),
        table('b', 'b', [column('b_ref', 'ref', { kind: 'text' })]),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'b', columnId: 'b_ref' },
          to: { tableId: 'a', columnId: 'a_id' },
        },
      ]
    )
    assert.deepEqual(codes(schema), ['relationship-type-mismatch'])
  })

  it('ignores varchar length when comparing types', () => {
    const schema = schemaOf(
      [
        table(
          'a',
          'a',
          [column('a_id', 'id', { kind: 'varchar', length: 10 })],
          ['a_id']
        ),
        table('b', 'b', [
          column('b_ref', 'ref', { kind: 'varchar', length: 40 }),
        ]),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'b', columnId: 'b_ref' },
          to: { tableId: 'a', columnId: 'a_id' },
        },
      ]
    )
    assert.deepEqual(validate(schema), [])
  })

  it('flags a target that is not a primary key', () => {
    const schema = schemaOf(
      [
        table('a', 'a', [column('a_id', 'id'), column('a_other', 'other')], [
          'a_id',
        ]),
        table('b', 'b', [column('b_ref', 'ref')]),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'b', columnId: 'b_ref' },
          to: { tableId: 'a', columnId: 'a_other' },
        },
      ]
    )
    assert.deepEqual(codes(schema), ['relationship-target-not-sole-primary-key'])
  })

  it('flags a target that is part of a composite primary key', () => {
    const schema = schemaOf(
      [
        table('a', 'a', [column('k1', 'k1'), column('k2', 'k2')], ['k1', 'k2']),
        table('b', 'b', [column('b_ref', 'ref')]),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'b', columnId: 'b_ref' },
          to: { tableId: 'a', columnId: 'k1' },
        },
      ]
    )
    assert.deepEqual(codes(schema), ['relationship-target-not-sole-primary-key'])
  })

  it('flags a relationship whose table or column does not exist', () => {
    const schema = addRelationship(usersOrders, {
      id: 'ghost',
      from: { tableId: 'orders', columnId: 'gone' },
      to: { tableId: 'users', columnId: 'u_id' },
    })
    assert.ok(codes(schema).includes('relationship-unknown-column'))
  })

  it('accepts a self-referencing relationship', () => {
    const schema = schemaOf(
      [
        table(
          'e',
          'employees',
          [
            column('e_id', 'id', { kind: 'uuid' }, false),
            column('e_mgr', 'manager_id', { kind: 'uuid' }),
          ],
          ['e_id']
        ),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'e', columnId: 'e_mgr' },
          to: { tableId: 'e', columnId: 'e_id' },
        },
      ]
    )
    assert.deepEqual(validate(schema), [])
  })
})

describe('checkRelationship', () => {
  const ordersTotal = { tableId: 'orders', columnId: 'o_total' }
  const usersId = { tableId: 'users', columnId: 'u_id' }

  it('returns null for an allowed relationship', () => {
    const noRelationships = schemaOf(usersOrders.tables)
    assert.equal(
      checkRelationship(
        noRelationships,
        { tableId: 'orders', columnId: 'o_user' },
        usersId
      ),
      null
    )
  })

  it('reports the rule that the relationship would break', () => {
    const noRelationships = schemaOf(usersOrders.tables)
    assert.equal(
      checkRelationship(noRelationships, ordersTotal, usersId)?.code,
      'relationship-type-mismatch'
    )
    assert.equal(
      checkRelationship(
        noRelationships,
        { tableId: 'users', columnId: 'u_name' },
        { tableId: 'orders', columnId: 'o_user' }
      )?.code,
      'relationship-type-mismatch'
    )
    assert.equal(
      checkRelationship(
        noRelationships,
        { tableId: 'orders', columnId: 'o_user' },
        { tableId: 'orders', columnId: 'o_user' }
      )?.code,
      'relationship-target-not-sole-primary-key'
    )
  })

  it('refuses a second relationship from the same column', () => {
    assert.equal(
      checkRelationship(usersOrders, ordersToUsers.from, usersId)?.code,
      'multiple-relationships-from-column'
    )
  })

  it('reports unknown columns', () => {
    assert.equal(
      checkRelationship(
        usersOrders,
        { tableId: 'nope', columnId: 'x' },
        usersId
      )?.code,
      'relationship-unknown-column'
    )
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd packages/core && node --test src/tests/unit/schema/validate.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `schema/validate.ts`.

- [ ] **Step 3: Implement validation**

Create `packages/core/src/schema/validate.ts`:

```ts
import type {
  Column,
  ColumnId,
  ColumnRef,
  Relationship,
  RelationshipId,
  Schema,
  Table,
  TableId,
} from './types.ts'

export type IssueCode =
  | 'empty-table-name'
  | 'duplicate-table-name'
  | 'empty-column-name'
  | 'duplicate-column-name'
  | 'multiple-relationships-from-column'
  | 'relationship-unknown-column'
  | 'relationship-type-mismatch'
  | 'relationship-target-not-sole-primary-key'

export interface Issue {
  code: IssueCode
  message: string
  tableId?: TableId
  columnId?: ColumnId
  relationshipId?: RelationshipId
}

type IssueIds = Pick<Issue, 'tableId' | 'columnId' | 'relationshipId'>

function issue(code: IssueCode, message: string, ids: IssueIds = {}): Issue {
  const result: Issue = { code, message }
  if (ids.tableId !== undefined) result.tableId = ids.tableId
  if (ids.columnId !== undefined) result.columnId = ids.columnId
  if (ids.relationshipId !== undefined) {
    result.relationshipId = ids.relationshipId
  }
  return result
}

interface Located {
  table: Table
  column: Column
}

function locate(schema: Schema, ref: ColumnRef): Located | null {
  const table = schema.tables.find((candidate) => candidate.id === ref.tableId)
  const column = table?.columns.find((candidate) => candidate.id === ref.columnId)
  return table && column ? { table, column } : null
}

const isBlank = (name: string) => name.trim() === ''

function relationshipIssue(
  schema: Schema,
  from: ColumnRef,
  to: ColumnRef,
  others: Relationship[],
  relationshipId?: RelationshipId
): Issue | null {
  const source = locate(schema, from)
  const target = locate(schema, to)
  if (!source || !target) {
    return issue(
      'relationship-unknown-column',
      'A relationship points to a table or column that does not exist.',
      relationshipId === undefined ? {} : { relationshipId }
    )
  }

  const ids: IssueIds = {
    tableId: from.tableId,
    columnId: from.columnId,
    ...(relationshipId === undefined ? {} : { relationshipId }),
  }
  const sourceName = `${source.table.name}.${source.column.name}`
  const targetName = `${target.table.name}.${target.column.name}`

  const alreadySource = others.some(
    (other) =>
      other.from.tableId === from.tableId &&
      other.from.columnId === from.columnId
  )
  if (alreadySource) {
    return issue(
      'multiple-relationships-from-column',
      `Column "${sourceName}" is the source of more than one relationship.`,
      ids
    )
  }

  if (source.column.type.kind !== target.column.type.kind) {
    return issue(
      'relationship-type-mismatch',
      `Column "${sourceName}" (${source.column.type.kind}) cannot reference "${targetName}" (${target.column.type.kind}): the types differ.`,
      ids
    )
  }

  const primaryKey = target.table.primaryKey
  if (primaryKey.length !== 1 || primaryKey[0] !== target.column.id) {
    return issue(
      'relationship-target-not-sole-primary-key',
      `Column "${targetName}" cannot be referenced: it is not the sole primary key of its table.`,
      ids
    )
  }

  return null
}

/**
 * The issue that adding `from` → `to` would cause, or null when it is allowed.
 * A `from` column that already has a relationship in `schema` is an issue.
 */
export function checkRelationship(
  schema: Schema,
  from: ColumnRef,
  to: ColumnRef
): Issue | null {
  return relationshipIssue(schema, from, to, schema.relationships)
}

export function validate(schema: Schema): Issue[] {
  const issues: Issue[] = []

  const seenTables = new Set<string>()
  for (const table of schema.tables) {
    if (isBlank(table.name)) {
      issues.push(
        issue('empty-table-name', 'A table has an empty name.', {
          tableId: table.id,
        })
      )
    } else if (seenTables.has(table.name)) {
      issues.push(
        issue(
          'duplicate-table-name',
          `Table name "${table.name}" is used more than once.`,
          { tableId: table.id }
        )
      )
    }
    seenTables.add(table.name)

    const seenColumns = new Set<string>()
    for (const column of table.columns) {
      const ids = { tableId: table.id, columnId: column.id }
      if (isBlank(column.name)) {
        issues.push(
          issue(
            'empty-column-name',
            `A column in table "${table.name}" has an empty name.`,
            ids
          )
        )
      } else if (seenColumns.has(column.name)) {
        issues.push(
          issue(
            'duplicate-column-name',
            `Column name "${column.name}" is used more than once in table "${table.name}".`,
            ids
          )
        )
      }
      seenColumns.add(column.name)
    }
  }

  for (const relationship of schema.relationships) {
    const found = relationshipIssue(
      schema,
      relationship.from,
      relationship.to,
      schema.relationships.filter((other) => other.id !== relationship.id),
      relationship.id
    )
    if (found) issues.push(found)
  }

  return issues
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd packages/core && node --test src/tests/unit/schema/validate.test.ts`
Expected: PASS — 16 tests, 0 failures.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm --filter @forge/core typecheck && pnpm --filter @forge/core test
git add packages/core/src
git commit -m "feat(core): add schema validation and checkRelationship

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Core — dialect interface and PostgreSQL

**Files:**
- Create: `packages/core/src/dialects/dialect.ts`
- Create: `packages/core/src/dialects/postgres.ts`
- Test: `packages/core/src/tests/unit/dialects/postgres.test.ts`

**Interfaces:**
- Consumes: `ColumnType` from `schema/types.ts`.
- Produces:
  - `Dialect { id: string; maxIdentifierBytes: number; typeName(type: ColumnType): string; quoteIdentifier(name: string): string }` (`dialects/dialect.ts`). `maxIdentifierBytes` is a refinement of the spec's interface: the generator needs the dialect's identifier limit to truncate derived constraint names.
  - `postgres: Dialect` (`dialects/postgres.ts`) with `id: 'postgres'` and `maxIdentifierBytes: 63`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/tests/unit/dialects/postgres.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import type { ColumnType } from '../../../schema/types.ts'

describe('postgres.typeName', () => {
  const cases: [ColumnType, string][] = [
    [{ kind: 'integer' }, 'integer'],
    [{ kind: 'bigint' }, 'bigint'],
    [{ kind: 'text' }, 'text'],
    [{ kind: 'boolean' }, 'boolean'],
    [{ kind: 'uuid' }, 'uuid'],
    [{ kind: 'date' }, 'date'],
    [{ kind: 'timestamp' }, 'timestamptz'],
    [{ kind: 'json' }, 'jsonb'],
    [{ kind: 'varchar', length: 120 }, 'varchar(120)'],
    [{ kind: 'numeric', precision: 10, scale: 2 }, 'numeric(10,2)'],
  ]

  for (const [type, expected] of cases) {
    it(`maps ${JSON.stringify(type)} to ${expected}`, () => {
      assert.equal(postgres.typeName(type), expected)
    })
  }
})

describe('postgres.quoteIdentifier', () => {
  it('wraps the name in double quotes', () => {
    assert.equal(postgres.quoteIdentifier('users'), '"users"')
  })

  it('preserves case and spaces', () => {
    assert.equal(postgres.quoteIdentifier('Order Items'), '"Order Items"')
  })

  it('escapes embedded double quotes by doubling them', () => {
    assert.equal(postgres.quoteIdentifier('a"b'), '"a""b"')
    assert.equal(postgres.quoteIdentifier('"'), '""""')
  })

  it('keeps non-ASCII characters', () => {
    assert.equal(postgres.quoteIdentifier('coluna_ção'), '"coluna_ção"')
  })
})

describe('postgres metadata', () => {
  it('declares its id and identifier limit', () => {
    assert.equal(postgres.id, 'postgres')
    assert.equal(postgres.maxIdentifierBytes, 63)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd packages/core && node --test src/tests/unit/dialects/postgres.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `dialects/postgres.ts`.

- [ ] **Step 3: Implement the dialect**

Create `packages/core/src/dialects/dialect.ts`:

```ts
import type { ColumnType } from '../schema/types.ts'

export interface Dialect {
  id: string
  /** Longest identifier the database accepts, in UTF-8 bytes. */
  maxIdentifierBytes: number
  typeName(type: ColumnType): string
  quoteIdentifier(name: string): string
}
```

Create `packages/core/src/dialects/postgres.ts`:

```ts
import type { ColumnType } from '../schema/types.ts'
import type { Dialect } from './dialect.ts'

function typeName(type: ColumnType): string {
  switch (type.kind) {
    case 'integer':
      return 'integer'
    case 'bigint':
      return 'bigint'
    case 'text':
      return 'text'
    case 'boolean':
      return 'boolean'
    case 'uuid':
      return 'uuid'
    case 'date':
      return 'date'
    // The logical `timestamp` means an instant in time.
    case 'timestamp':
      return 'timestamptz'
    case 'json':
      return 'jsonb'
    case 'varchar':
      return `varchar(${type.length})`
    case 'numeric':
      return `numeric(${type.precision},${type.scale})`
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

export const postgres: Dialect = {
  id: 'postgres',
  maxIdentifierBytes: 63,
  typeName,
  quoteIdentifier,
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd packages/core && node --test src/tests/unit/dialects/postgres.test.ts`
Expected: PASS — 15 tests, 0 failures.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm --filter @forge/core typecheck && pnpm --filter @forge/core test
git add packages/core/src
git commit -m "feat(core): add the dialect interface and the PostgreSQL dialect

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Core — DDL generator

**Files:**
- Create: `packages/core/src/sql/generate/constraint-names.ts`
- Create: `packages/core/src/sql/generate/generate-ddl.ts`
- Test: `packages/core/src/tests/unit/sql/generate/constraint-names.test.ts`
- Test: `packages/core/src/tests/unit/sql/generate/generate-ddl.test.ts`
- Test: `packages/core/src/tests/integration/sql/generate-ddl.test.ts`

**Interfaces:**
- Consumes: `Schema`, `Table`, `Relationship` (`schema/types.ts`); `validate`, `Issue` (`schema/validate.ts`); `Dialect` (`dialects/dialect.ts`), `postgres` (`dialects/postgres.ts`); the operations from Task 1 and the test helpers from Tasks 1 and 2.
- Produces:
  - `byteLength(text: string): number` — UTF-8 byte length
  - `truncateToBytes(text: string, maxBytes: number): string` — never cuts a character in half
  - `uniqueName(base: string, used: Set<string>, maxBytes: number): string` — truncates `base` to `maxBytes`; on a collision with `used` appends `_2`, `_3`, … (still within `maxBytes`) and records the result in `used`. A refinement of the spec, which only said "truncated to 63 characters": collisions after truncation would otherwise produce duplicate constraint names.
  - `GenerateResult = { ok: true; sql: string } | { ok: false; issues: Issue[] }`
  - `generateDdl(schema: Schema, dialect: Dialect): GenerateResult`

Output format (every golden string in the tests follows it): a `CREATE TABLE` per table in schema order, columns two-space indented, `NOT NULL` for non-nullable columns and for primary-key columns, an inline `PRIMARY KEY (...)` when the key is not empty; then one `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` per relationship; statements separated by a blank line; the whole text ends with one newline; an empty schema yields `''`.

- [ ] **Step 1: Write the failing unit tests for the naming helpers**

Create `packages/core/src/tests/unit/sql/generate/constraint-names.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  byteLength,
  truncateToBytes,
  uniqueName,
} from '../../../../sql/generate/constraint-names.ts'

describe('byteLength', () => {
  it('counts UTF-8 bytes, not characters', () => {
    assert.equal(byteLength('abc'), 3)
    assert.equal(byteLength('ç'), 2)
    assert.equal(byteLength('€'), 3)
    assert.equal(byteLength('😀'), 4)
  })
})

describe('truncateToBytes', () => {
  it('returns the text unchanged when it fits', () => {
    assert.equal(truncateToBytes('abc', 3), 'abc')
  })

  it('cuts ASCII at the byte limit', () => {
    assert.equal(truncateToBytes('abcdef', 4), 'abcd')
  })

  it('never splits a multi-byte character', () => {
    assert.equal(truncateToBytes('ñññ', 5), 'ññ')
    assert.equal(truncateToBytes('😀😀', 5), '😀')
    assert.equal(truncateToBytes('😀', 3), '')
  })
})

describe('uniqueName', () => {
  it('returns the base and records it', () => {
    const used = new Set<string>()
    assert.equal(uniqueName('fk_a', used, 63), 'fk_a')
    assert.ok(used.has('fk_a'))
  })

  it('appends a numeric suffix on a collision', () => {
    const used = new Set<string>()
    assert.equal(uniqueName('fk_a', used, 63), 'fk_a')
    assert.equal(uniqueName('fk_a', used, 63), 'fk_a_2')
    assert.equal(uniqueName('fk_a', used, 63), 'fk_a_3')
  })

  it('keeps the suffixed name within the byte limit', () => {
    const used = new Set<string>()
    const long = 'x'.repeat(80)
    const first = uniqueName(long, used, 63)
    const second = uniqueName(long, used, 63)
    assert.equal(byteLength(first), 63)
    assert.equal(byteLength(second), 63)
    assert.ok(second.endsWith('_2'))
    assert.notEqual(first, second)
  })
})
```

- [ ] **Step 2: Run them and verify they fail**

Run: `cd packages/core && node --test src/tests/unit/sql/generate/constraint-names.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `constraint-names.ts`.

- [ ] **Step 3: Implement the naming helpers**

Create `packages/core/src/sql/generate/constraint-names.ts`:

```ts
function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

export function byteLength(text: string): number {
  let total = 0
  for (const char of text) total += utf8Size(char.codePointAt(0) ?? 0)
  return total
}

export function truncateToBytes(text: string, maxBytes: number): string {
  let total = 0
  let result = ''
  for (const char of text) {
    const size = utf8Size(char.codePointAt(0) ?? 0)
    if (total + size > maxBytes) break
    total += size
    result += char
  }
  return result
}

export function uniqueName(
  base: string,
  used: Set<string>,
  maxBytes: number
): string {
  const truncated = truncateToBytes(base, maxBytes)
  if (!used.has(truncated)) {
    used.add(truncated)
    return truncated
  }
  for (let attempt = 2; ; attempt++) {
    const suffix = `_${attempt}`
    const candidate =
      truncateToBytes(base, maxBytes - byteLength(suffix)) + suffix
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}
```

- [ ] **Step 4: Run them and verify they pass**

Run: `cd packages/core && node --test src/tests/unit/sql/generate/constraint-names.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Write the failing unit tests for `generateDdl`**

Create `packages/core/src/tests/unit/sql/generate/generate-ddl.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../../dialects/postgres.ts'
import { generateDdl } from '../../../../sql/generate/generate-ddl.ts'
import { schemaOf, table } from '../../../helpers/schema-builders.ts'

describe('generateDdl', () => {
  it('returns the validation issues and no SQL for an invalid schema', () => {
    const result = generateDdl(schemaOf([table('t', '')]), postgres)
    assert.ok(!result.ok)
    assert.equal(result.issues[0]?.code, 'empty-table-name')
  })

  it('returns an empty string for an empty schema', () => {
    assert.deepEqual(generateDdl(schemaOf([]), postgres), {
      ok: true,
      sql: '',
    })
  })
})
```

- [ ] **Step 6: Write the failing golden integration tests**

Create `packages/core/src/tests/integration/sql/generate-ddl.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { postgres } from '../../../dialects/postgres.ts'
import {
  addColumn,
  addRelationship,
  addTable,
  createSchema,
  setPrimaryKey,
} from '../../../schema/operations.ts'
import { byteLength } from '../../../sql/generate/constraint-names.ts'
import { generateDdl } from '../../../sql/generate/generate-ddl.ts'
import { usersOrders } from '../../helpers/fixtures.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

const uuid = { kind: 'uuid' } as const

function sqlOf(schema: Parameters<typeof generateDdl>[0]): string {
  const result = generateDdl(schema, postgres)
  assert.ok(result.ok, JSON.stringify(result))
  return result.sql
}

const lines = (...parts: string[]) => `${parts.join('\n')}\n`

describe('generateDdl golden output', () => {
  it('generates users and orders with a foreign key', () => {
    assert.equal(
      sqlOf(usersOrders),
      lines(
        'CREATE TABLE "users" (',
        '  "id" uuid NOT NULL,',
        '  "name" varchar(120) NOT NULL,',
        '  PRIMARY KEY ("id")',
        ');',
        '',
        'CREATE TABLE "orders" (',
        '  "id" uuid NOT NULL,',
        '  "user_id" uuid NOT NULL,',
        '  "total" numeric(10,2),',
        '  "created_at" timestamptz NOT NULL,',
        '  PRIMARY KEY ("id")',
        ');',
        '',
        'ALTER TABLE "orders"',
        '  ADD CONSTRAINT "fk_orders_user_id"',
        '  FOREIGN KEY ("user_id") REFERENCES "users" ("id");'
      )
    )
  })

  it('generates the same SQL when the schema is built through operations', () => {
    let schema = createSchema()
    schema = addTable(schema, { id: 'users', name: 'users' })
    schema = addColumn(schema, 'users', column('u_id', 'id', uuid, false))
    schema = setPrimaryKey(schema, 'users', ['u_id'])
    schema = addTable(schema, { id: 'orders', name: 'orders' })
    schema = addColumn(schema, 'orders', column('o_user', 'user_id', uuid))
    schema = addRelationship(schema, {
      id: 'fk1',
      from: { tableId: 'orders', columnId: 'o_user' },
      to: { tableId: 'users', columnId: 'u_id' },
    })
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "users" (',
        '  "id" uuid NOT NULL,',
        '  PRIMARY KEY ("id")',
        ');',
        '',
        'CREATE TABLE "orders" (',
        '  "user_id" uuid',
        ');',
        '',
        'ALTER TABLE "orders"',
        '  ADD CONSTRAINT "fk_orders_user_id"',
        '  FOREIGN KEY ("user_id") REFERENCES "users" ("id");'
      )
    )
  })

  it('generates a composite primary key in key order', () => {
    const schema = schemaOf([
      table(
        'items',
        'order_items',
        [
          column('c1', 'order_id', uuid),
          column('c2', 'product_id', uuid),
          column('c3', 'quantity', { kind: 'integer' }, false),
        ],
        ['c2', 'c1']
      ),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "order_items" (',
        '  "order_id" uuid NOT NULL,',
        '  "product_id" uuid NOT NULL,',
        '  "quantity" integer NOT NULL,',
        '  PRIMARY KEY ("product_id", "order_id")',
        ');'
      )
    )
  })

  it('quotes and escapes names', () => {
    const schema = schemaOf([
      table('t', 'Weird "Name"', [
        column('c1', 'my col'),
        column('c2', 'coluna_ção'),
      ]),
    ])
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "Weird ""Name""" (',
        '  "my col" text,',
        '  "coluna_ção" text',
        ');'
      )
    )
  })

  it('handles empty, columnless and key-less tables', () => {
    assert.equal(sqlOf(schemaOf([])), '')
    assert.equal(
      sqlOf(schemaOf([table('t', 'empty')])),
      lines('CREATE TABLE "empty" ();')
    )
    assert.equal(
      sqlOf(schemaOf([table('t', 'log', [column('c', 'message')])])),
      lines('CREATE TABLE "log" (', '  "message" text', ');')
    )
  })

  it('makes primary-key columns NOT NULL even when marked nullable', () => {
    const schema = schemaOf([
      table('t', 'a', [column('c', 'id', uuid, true)], ['c']),
    ])
    assert.equal(
      sqlOf(schema),
      lines('CREATE TABLE "a" (', '  "id" uuid NOT NULL,', '  PRIMARY KEY ("id")', ');')
    )
  })

  it('generates a self-referencing foreign key', () => {
    const schema = schemaOf(
      [
        table(
          'e',
          'employees',
          [column('e_id', 'id', uuid, false), column('e_mgr', 'manager_id', uuid)],
          ['e_id']
        ),
      ],
      [
        {
          id: 'r',
          from: { tableId: 'e', columnId: 'e_mgr' },
          to: { tableId: 'e', columnId: 'e_id' },
        },
      ]
    )
    assert.equal(
      sqlOf(schema),
      lines(
        'CREATE TABLE "employees" (',
        '  "id" uuid NOT NULL,',
        '  "manager_id" uuid,',
        '  PRIMARY KEY ("id")',
        ');',
        '',
        'ALTER TABLE "employees"',
        '  ADD CONSTRAINT "fk_employees_manager_id"',
        '  FOREIGN KEY ("manager_id") REFERENCES "employees" ("id");'
      )
    )
  })

  it('generates circular foreign keys after every table', () => {
    const schema = schemaOf(
      [
        table(
          'a',
          'a',
          [column('a_id', 'id', uuid, false), column('a_b', 'b_id', uuid)],
          ['a_id']
        ),
        table(
          'b',
          'b',
          [column('b_id', 'id', uuid, false), column('b_a', 'a_id', uuid)],
          ['b_id']
        ),
      ],
      [
        {
          id: 'r1',
          from: { tableId: 'a', columnId: 'a_b' },
          to: { tableId: 'b', columnId: 'b_id' },
        },
        {
          id: 'r2',
          from: { tableId: 'b', columnId: 'b_a' },
          to: { tableId: 'a', columnId: 'a_id' },
        },
      ]
    )
    const sql = sqlOf(schema)
    const lastCreate = sql.lastIndexOf('CREATE TABLE')
    const firstAlter = sql.indexOf('ALTER TABLE')
    assert.ok(firstAlter > lastCreate)
    assert.equal((sql.match(/ALTER TABLE/g) ?? []).length, 2)
  })

  it('truncates long constraint names and keeps them unique', () => {
    const longA = `${'t'.repeat(70)}1`
    const longB = `${'t'.repeat(70)}2`
    const schema = schemaOf(
      [
        table(
          'ta',
          longA,
          [column('ta_id', 'id', uuid, false), column('ta_ref', 'ref', uuid)],
          ['ta_id']
        ),
        table('tb', longB, [column('tb_ref', 'ref', uuid)]),
      ],
      [
        {
          id: 'r1',
          from: { tableId: 'ta', columnId: 'ta_ref' },
          to: { tableId: 'ta', columnId: 'ta_id' },
        },
        {
          id: 'r2',
          from: { tableId: 'tb', columnId: 'tb_ref' },
          to: { tableId: 'ta', columnId: 'ta_id' },
        },
      ]
    )
    const sql = sqlOf(schema)
    const names = [...sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map(
      (match) => match[1] ?? ''
    )
    assert.equal(names.length, 2)
    for (const name of names) assert.ok(byteLength(name) <= 63, name)
    assert.notEqual(names[0], names[1])
    assert.ok(names[1]?.endsWith('_2'))
    assert.ok(sql.includes(`"${longA}"`), 'table names are never truncated')
  })
})
```

- [ ] **Step 7: Run both and verify they fail**

Run: `cd packages/core && node --test src/tests/unit/sql/generate/generate-ddl.test.ts src/tests/integration/sql/generate-ddl.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `generate-ddl.ts`.

- [ ] **Step 8: Implement the generator**

Create `packages/core/src/sql/generate/generate-ddl.ts`:

```ts
import type { Dialect } from '../../dialects/dialect.ts'
import type { Column, Relationship, Schema, Table } from '../../schema/types.ts'
import { validate } from '../../schema/validate.ts'
import type { Issue } from '../../schema/validate.ts'
import { uniqueName } from './constraint-names.ts'

export type GenerateResult =
  | { ok: true; sql: string }
  | { ok: false; issues: Issue[] }

function requireTable(schema: Schema, tableId: string): Table {
  const found = schema.tables.find((table) => table.id === tableId)
  if (!found) throw new Error(`Unknown table "${tableId}" in a valid schema.`)
  return found
}

function requireColumn(table: Table, columnId: string): Column {
  const found = table.columns.find((column) => column.id === columnId)
  if (!found) {
    throw new Error(`Unknown column "${columnId}" in table "${table.name}".`)
  }
  return found
}

function createTable(table: Table, dialect: Dialect): string {
  const quote = (name: string) => dialect.quoteIdentifier(name)
  const lines = table.columns.map((column) => {
    const required = !column.nullable || table.primaryKey.includes(column.id)
    return `  ${quote(column.name)} ${dialect.typeName(column.type)}${required ? ' NOT NULL' : ''}`
  })
  if (table.primaryKey.length > 0) {
    const names = table.primaryKey.map((id) =>
      quote(requireColumn(table, id).name)
    )
    lines.push(`  PRIMARY KEY (${names.join(', ')})`)
  }
  if (lines.length === 0) return `CREATE TABLE ${quote(table.name)} ();`
  return `CREATE TABLE ${quote(table.name)} (\n${lines.join(',\n')}\n);`
}

function addForeignKey(
  schema: Schema,
  relationship: Relationship,
  dialect: Dialect,
  usedNames: Set<string>
): string {
  const quote = (name: string) => dialect.quoteIdentifier(name)
  const fromTable = requireTable(schema, relationship.from.tableId)
  const fromColumn = requireColumn(fromTable, relationship.from.columnId)
  const toTable = requireTable(schema, relationship.to.tableId)
  const toColumn = requireColumn(toTable, relationship.to.columnId)
  const name = uniqueName(
    `fk_${fromTable.name}_${fromColumn.name}`,
    usedNames,
    dialect.maxIdentifierBytes
  )
  return [
    `ALTER TABLE ${quote(fromTable.name)}`,
    `  ADD CONSTRAINT ${quote(name)}`,
    `  FOREIGN KEY (${quote(fromColumn.name)}) REFERENCES ${quote(toTable.name)} (${quote(toColumn.name)});`,
  ].join('\n')
}

export function generateDdl(schema: Schema, dialect: Dialect): GenerateResult {
  const issues = validate(schema)
  if (issues.length > 0) return { ok: false, issues }

  const statements = schema.tables.map((table) => createTable(table, dialect))
  const usedNames = new Set<string>()
  for (const relationship of schema.relationships) {
    statements.push(addForeignKey(schema, relationship, dialect, usedNames))
  }

  return {
    ok: true,
    sql: statements.length === 0 ? '' : `${statements.join('\n\n')}\n`,
  }
}
```

- [ ] **Step 9: Run both and verify they pass**

Run: `cd packages/core && node --test src/tests/unit/sql/generate/generate-ddl.test.ts src/tests/integration/sql/generate-ddl.test.ts`
Expected: PASS — 11 tests (2 unit, 9 integration), 0 failures. If a golden string differs, fix the generator, never the string: the strings are the spec.

- [ ] **Step 10: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm --filter @forge/core typecheck && pnpm --filter @forge/core test
git add packages/core/src
git commit -m "feat(core): generate PostgreSQL DDL from a schema

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Core — project document, `parseProject` and public exports

**Files:**
- Create: `packages/core/src/project/project.ts`
- Create: `packages/core/src/project/parse-project.ts`
- Modify: `packages/core/src/index.ts` (replace `export {}` with the public API)
- Test: `packages/core/src/tests/unit/project/parse-project.test.ts`
- Test: `packages/core/src/tests/integration/project/round-trip.test.ts`

**Interfaces:**
- Consumes: all of `schema/types.ts`, `schema/validate.ts`, `generateDdl`, `postgres`, test helpers and fixtures.
- Produces:
  - `CURRENT_FORMAT_VERSION = 1`
  - `Project { formatVersion: 1; schema: Schema; view: unknown }`
  - `createProject(schema: Schema, view: unknown): Project`
  - `ParseError { path: string; message: string }`
  - `ParseResult = { ok: true; project: Project } | { ok: false; errors: ParseError[] }`
  - `parseProject(input: unknown): ParseResult` — checks shape, `formatVersion`, the schema's structure and its referential integrity (a relationship must point at an existing table and column, a primary key at existing columns, ids must be unique). It does **not** reject a schema that merely has validation issues (empty names, type mismatches): a saved draft may be incomplete. A missing `view` becomes `null`.
  - `src/index.ts` exports, as the package's public API: all types, `SIMPLE_COLUMN_KINDS`, `MAX_VARCHAR_LENGTH` and `MAX_NUMERIC_PRECISION` from `schema/types.ts`; every function from `schema/operations.ts`; `validate`, `checkRelationship`, `Issue`, `IssueCode`; `Dialect`, `postgres`; `generateDdl`, `GenerateResult`; `CURRENT_FORMAT_VERSION`, `Project`, `createProject`, `parseProject`, `ParseError`, `ParseResult`.

- [ ] **Step 1: Write the failing unit tests**

Create `packages/core/src/tests/unit/project/parse-project.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createProject } from '../../../project/project.ts'
import { parseProject } from '../../../project/parse-project.ts'
import { usersOrders } from '../../helpers/fixtures.ts'
import { column, schemaOf, table } from '../../helpers/schema-builders.ts'

const valid = () => JSON.parse(JSON.stringify(createProject(usersOrders, { a: 1 })))

function errorPaths(input: unknown): string[] {
  const result = parseProject(input)
  assert.ok(!result.ok, 'expected a parse failure')
  return result.errors.map((error) => error.path)
}

// Errors are collected in document order, so the first one is the root cause;
// anything after it may be a consequence (a dropped column breaks the primary
// key and relationships that referred to it).
const firstErrorPath = (input: unknown) => errorPaths(input)[0]

describe('parseProject', () => {
  it('accepts a valid project and keeps the view', () => {
    const result = parseProject(valid())
    assert.ok(result.ok)
    assert.deepEqual(result.project.schema, usersOrders)
    assert.deepEqual(result.project.view, { a: 1 })
  })

  it('turns a missing view into null', () => {
    const input = valid()
    delete input.view
    const result = parseProject(input)
    assert.ok(result.ok)
    assert.equal(result.project.view, null)
  })

  it('accepts a draft with validation issues', () => {
    const draft = createProject(schemaOf([table('t', ''), table('u', '')]), null)
    assert.ok(parseProject(JSON.parse(JSON.stringify(draft))).ok)
  })

  it('rejects values that are not a project object', () => {
    for (const input of [null, undefined, 42, 'text', [], true]) {
      assert.equal(firstErrorPath(input), '')
    }
  })

  it('rejects an unknown or newer format version with a clear message', () => {
    const input = valid()
    input.formatVersion = 2
    const result = parseProject(input)
    assert.ok(!result.ok)
    assert.equal(result.errors[0]?.path, 'formatVersion')
    assert.match(result.errors[0]?.message ?? '', /version 2/)
  })

  it('rejects a schema of an unsupported version or shape', () => {
    const wrongVersion = valid()
    wrongVersion.schema.version = 9
    assert.equal(firstErrorPath(wrongVersion), 'schema.version')

    const noTables = valid()
    delete noTables.schema.tables
    assert.equal(firstErrorPath(noTables), 'schema.tables')
  })

  it('rejects a relationship that points at a missing table or column', () => {
    const missingTable = valid()
    missingTable.schema.relationships[0].to.tableId = 'gone'
    assert.equal(firstErrorPath(missingTable), 'schema.relationships[0].to')

    const missingColumn = valid()
    missingColumn.schema.relationships[0].from.columnId = 'gone'
    assert.equal(firstErrorPath(missingColumn), 'schema.relationships[0].from')
  })

  it('rejects a primary key that names a missing column', () => {
    const input = valid()
    input.schema.tables[0].primaryKey = ['gone']
    assert.equal(firstErrorPath(input), 'schema.tables[0].primaryKey[0]')
  })

  it('rejects duplicate ids', () => {
    const tables = valid()
    tables.schema.tables[1].id = 'users'
    assert.equal(firstErrorPath(tables), 'schema.tables[1].id')

    const columns = valid()
    columns.schema.tables[0].columns[1].id = 'u_id'
    assert.equal(firstErrorPath(columns), 'schema.tables[0].columns[1].id')
  })

  it('rejects invalid column types', () => {
    const cases: unknown[] = [
      { kind: 'nope' },
      { kind: 'varchar' },
      { kind: 'varchar', length: 0 },
      { kind: 'varchar', length: 1.5 },
      { kind: 'varchar', length: 10485761 },
      { kind: 'numeric', precision: 5 },
      { kind: 'numeric', precision: 5, scale: 6 },
      { kind: 'numeric', precision: 1001, scale: 0 },
      'text',
      null,
    ]
    for (const type of cases) {
      const input = valid()
      input.schema.tables[0].columns[0].type = type
      assert.equal(firstErrorPath(input), 'schema.tables[0].columns[0].type')
    }
  })

  it('rejects a column with a wrong field type', () => {
    const input = valid()
    input.schema.tables[0].columns[0].nullable = 'no'
    assert.equal(firstErrorPath(input), 'schema.tables[0].columns[0].nullable')
  })

  it('reports every problem, not just the first', () => {
    const input = valid()
    input.schema.tables[0].primaryKey = ['gone']
    input.schema.relationships[0].to.tableId = 'gone'
    assert.equal(errorPaths(input).length, 2)
  })

  it('accepts every logical type', () => {
    const everyType = schemaOf([
      table('t', 't', [
        column('a', 'a', { kind: 'integer' }),
        column('b', 'b', { kind: 'varchar', length: 10485760 }),
        column('c', 'c', { kind: 'numeric', precision: 1000, scale: 1000 }),
      ]),
    ])
    assert.ok(parseProject(JSON.parse(JSON.stringify(createProject(everyType, null)))).ok)
  })
})
```

- [ ] **Step 2: Run them and verify they fail**

Run: `cd packages/core && node --test src/tests/unit/project/parse-project.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `project/project.ts`.

- [ ] **Step 3: Implement the project document**

Create `packages/core/src/project/project.ts`:

```ts
import type { Schema } from '../schema/types.ts'

export const CURRENT_FORMAT_VERSION = 1

/**
 * The saved document. `view` is opaque to the core: the web app puts node
 * positions and the viewport there, and the core only passes it through.
 */
export interface Project {
  formatVersion: 1
  schema: Schema
  view: unknown
}

export function createProject(schema: Schema, view: unknown): Project {
  return { formatVersion: CURRENT_FORMAT_VERSION, schema, view }
}
```

Create `packages/core/src/project/parse-project.ts`:

```ts
import {
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
  SIMPLE_COLUMN_KINDS,
} from '../schema/types.ts'
import type {
  Column,
  ColumnType,
  Relationship,
  Schema,
  SimpleColumnKind,
  Table,
} from '../schema/types.ts'
import { CURRENT_FORMAT_VERSION } from './project.ts'
import type { Project } from './project.ts'

export interface ParseError {
  path: string
  message: string
}

export type ParseResult =
  | { ok: true; project: Project }
  | { ok: false; errors: ParseError[] }

type Fail = (path: string, message: string) => void

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

function readString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fail: Fail
): string | undefined {
  const value = source[key]
  if (typeof value !== 'string') {
    fail(`${path}.${key}`, `"${key}" must be a string.`)
    return undefined
  }
  return value
}

function parseType(raw: unknown, path: string, fail: Fail): ColumnType | undefined {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    fail(path, 'A column type must be an object with a "kind".')
    return undefined
  }
  const { kind } = raw
  if ((SIMPLE_COLUMN_KINDS as readonly string[]).includes(kind)) {
    return { kind: kind as SimpleColumnKind }
  }
  if (kind === 'varchar') {
    const length = raw.length
    if (!isInteger(length) || length < 1 || length > MAX_VARCHAR_LENGTH) {
      fail(path, `varchar needs an integer length from 1 to ${MAX_VARCHAR_LENGTH}.`)
      return undefined
    }
    return { kind: 'varchar', length }
  }
  if (kind === 'numeric') {
    const { precision, scale } = raw
    if (
      !isInteger(precision) ||
      !isInteger(scale) ||
      precision < 1 ||
      precision > MAX_NUMERIC_PRECISION ||
      scale < 0 ||
      scale > precision
    ) {
      fail(
        path,
        `numeric needs an integer precision from 1 to ${MAX_NUMERIC_PRECISION} and a scale from 0 to the precision.`
      )
      return undefined
    }
    return { kind: 'numeric', precision, scale }
  }
  fail(path, `Unknown column type "${kind}".`)
  return undefined
}

function parseColumn(raw: unknown, path: string, fail: Fail): Column | undefined {
  if (!isRecord(raw)) {
    fail(path, 'A column must be an object.')
    return undefined
  }
  const id = readString(raw, 'id', path, fail)
  const name = readString(raw, 'name', path, fail)
  const type = parseType(raw.type, `${path}.type`, fail)
  if (typeof raw.nullable !== 'boolean') {
    fail(`${path}.nullable`, '"nullable" must be a boolean.')
    return undefined
  }
  if (id === undefined || name === undefined || type === undefined) {
    return undefined
  }
  return { id, name, type, nullable: raw.nullable }
}

function parseTable(raw: unknown, path: string, fail: Fail): Table | undefined {
  if (!isRecord(raw)) {
    fail(path, 'A table must be an object.')
    return undefined
  }
  const id = readString(raw, 'id', path, fail)
  const name = readString(raw, 'name', path, fail)
  if (!Array.isArray(raw.columns)) {
    fail(`${path}.columns`, '"columns" must be an array.')
    return undefined
  }
  if (!Array.isArray(raw.primaryKey)) {
    fail(`${path}.primaryKey`, '"primaryKey" must be an array.')
    return undefined
  }

  const columns: Column[] = []
  const columnIds = new Set<string>()
  raw.columns.forEach((rawColumn: unknown, index: number) => {
    const columnPath = `${path}.columns[${index}]`
    const column = parseColumn(rawColumn, columnPath, fail)
    if (!column) return
    if (columnIds.has(column.id)) {
      fail(`${columnPath}.id`, `Duplicate column id "${column.id}".`)
      return
    }
    columnIds.add(column.id)
    columns.push(column)
  })

  const primaryKey: string[] = []
  raw.primaryKey.forEach((entry: unknown, index: number) => {
    if (typeof entry !== 'string' || !columnIds.has(entry)) {
      fail(
        `${path}.primaryKey[${index}]`,
        'A primary key entry must be the id of a column of the table.'
      )
      return
    }
    primaryKey.push(entry)
  })

  if (id === undefined || name === undefined) return undefined
  return { id, name, columns, primaryKey }
}

function parseColumnRef(
  raw: unknown,
  path: string,
  tables: Table[],
  fail: Fail
): { tableId: string; columnId: string } | undefined {
  if (
    !isRecord(raw) ||
    typeof raw.tableId !== 'string' ||
    typeof raw.columnId !== 'string'
  ) {
    fail(path, 'A column reference needs a "tableId" and a "columnId".')
    return undefined
  }
  const { tableId, columnId } = raw
  const table = tables.find((candidate) => candidate.id === tableId)
  if (!table?.columns.some((column) => column.id === columnId)) {
    fail(path, `The column "${tableId}.${columnId}" does not exist.`)
    return undefined
  }
  return { tableId, columnId }
}

function parseSchema(raw: unknown, path: string, fail: Fail): Schema | undefined {
  if (!isRecord(raw)) {
    fail(path, 'The schema must be an object.')
    return undefined
  }
  if (raw.version !== 1) {
    fail(`${path}.version`, `Unsupported schema version ${JSON.stringify(raw.version)}.`)
    return undefined
  }
  if (!Array.isArray(raw.tables)) {
    fail(`${path}.tables`, '"tables" must be an array.')
    return undefined
  }
  if (!Array.isArray(raw.relationships)) {
    fail(`${path}.relationships`, '"relationships" must be an array.')
    return undefined
  }

  const tables: Table[] = []
  const tableIds = new Set<string>()
  raw.tables.forEach((rawTable: unknown, index: number) => {
    const tablePath = `${path}.tables[${index}]`
    const table = parseTable(rawTable, tablePath, fail)
    if (!table) return
    if (tableIds.has(table.id)) {
      fail(`${tablePath}.id`, `Duplicate table id "${table.id}".`)
      return
    }
    tableIds.add(table.id)
    tables.push(table)
  })

  const relationships: Relationship[] = []
  const relationshipIds = new Set<string>()
  raw.relationships.forEach((rawRelationship: unknown, index: number) => {
    const relationshipPath = `${path}.relationships[${index}]`
    if (!isRecord(rawRelationship)) {
      fail(relationshipPath, 'A relationship must be an object.')
      return
    }
    const id = readString(rawRelationship, 'id', relationshipPath, fail)
    const from = parseColumnRef(rawRelationship.from, `${relationshipPath}.from`, tables, fail)
    const to = parseColumnRef(rawRelationship.to, `${relationshipPath}.to`, tables, fail)
    if (id === undefined || !from || !to) return
    if (relationshipIds.has(id)) {
      fail(`${relationshipPath}.id`, `Duplicate relationship id "${id}".`)
      return
    }
    relationshipIds.add(id)
    relationships.push({ id, from, to })
  })

  return { version: 1, tables, relationships }
}

export function parseProject(input: unknown): ParseResult {
  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: '', message: 'A project must be an object.' }] }
  }
  if (input.formatVersion !== CURRENT_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        {
          path: 'formatVersion',
          message: `Unsupported format version ${JSON.stringify(input.formatVersion)}; this app reads version ${CURRENT_FORMAT_VERSION}.`,
        },
      ],
    }
  }

  const errors: ParseError[] = []
  const schema = parseSchema(input.schema, 'schema', (path, message) => {
    errors.push({ path, message })
  })
  if (errors.length > 0 || !schema) return { ok: false, errors }

  return {
    ok: true,
    project: {
      formatVersion: CURRENT_FORMAT_VERSION,
      schema,
      view: input.view ?? null,
    },
  }
}
```

- [ ] **Step 4: Run the unit tests and verify they pass**

Run: `cd packages/core && node --test src/tests/unit/project/parse-project.test.ts`
Expected: PASS — 13 tests, 0 failures. If the "reports every problem" test fails because only one error comes back, the parse functions are returning early too soon: each should keep collecting after a failure inside its own block.

- [ ] **Step 5: Write the failing integration test and the public exports**

Replace the contents of `packages/core/src/index.ts` with:

```ts
export {
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
  SIMPLE_COLUMN_KINDS,
} from './schema/types.ts'
export type {
  Column,
  ColumnId,
  ColumnRef,
  ColumnType,
  Relationship,
  RelationshipId,
  Schema,
  SimpleColumnKind,
  Table,
  TableId,
} from './schema/types.ts'

export {
  addColumn,
  addRelationship,
  addTable,
  createSchema,
  removeColumn,
  removeRelationship,
  removeTable,
  renameTable,
  setPrimaryKey,
  updateColumn,
} from './schema/operations.ts'

export { checkRelationship, validate } from './schema/validate.ts'
export type { Issue, IssueCode } from './schema/validate.ts'

export type { Dialect } from './dialects/dialect.ts'
export { postgres } from './dialects/postgres.ts'

export { generateDdl } from './sql/generate/generate-ddl.ts'
export type { GenerateResult } from './sql/generate/generate-ddl.ts'

export { CURRENT_FORMAT_VERSION, createProject } from './project/project.ts'
export type { Project } from './project/project.ts'
export { parseProject } from './project/parse-project.ts'
export type { ParseError, ParseResult } from './project/parse-project.ts'
```

Create `packages/core/src/tests/integration/project/round-trip.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createProject,
  generateDdl,
  parseProject,
  postgres,
} from '../../../index.ts'
import { usersOrders } from '../../helpers/fixtures.ts'

describe('project round trip', () => {
  it('survives JSON serialization unchanged', () => {
    const view = { nodes: { users: { x: 1, y: 2 } }, viewport: { x: 0, y: 0, zoom: 1 } }
    const stored = JSON.stringify(createProject(usersOrders, view))
    const parsed = parseProject(JSON.parse(stored))
    assert.ok(parsed.ok)
    assert.deepEqual(parsed.project, createProject(usersOrders, view))
  })

  it('generates identical DDL before and after a round trip', () => {
    const before = generateDdl(usersOrders, postgres)
    const parsed = parseProject(
      JSON.parse(JSON.stringify(createProject(usersOrders, null)))
    )
    assert.ok(parsed.ok)
    const after = generateDdl(parsed.project.schema, postgres)
    assert.deepEqual(after, before)
  })
})
```

- [ ] **Step 6: Run the whole core suite**

Run: `pnpm --filter @forge/core test`
Expected: PASS — 83 tests across Tasks 1–5, 0 failures, none skipped.

- [ ] **Step 7: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm --filter @forge/core typecheck && pnpm --filter @forge/core test
git add packages/core/src
git commit -m "feat(core): add the project document, parseProject and public exports

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: Web — foundations (TanStack Query, column-type helpers, project view)

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml` (via `pnpm add`)
- Create: `apps/web/src/lib/column-types.ts`
- Create: `apps/web/src/lib/project-view.ts`
- Test: `apps/web/src/tests/unit/lib/column-types.test.ts`
- Test: `apps/web/src/tests/unit/lib/project-view.test.ts`

**Interfaces:**
- Consumes: from `@forge/core` — `ColumnType`, `TableId`, `SIMPLE_COLUMN_KINDS`, `MAX_VARCHAR_LENGTH`, `MAX_NUMERIC_PRECISION` (Tasks 1 and 5).
- Produces (`lib/column-types.ts`):
  - `COLUMN_KINDS` (readonly tuple: the simple kinds, then `'varchar'`, `'numeric'`), `ColumnKind`
  - `defaultColumnType(kind: ColumnKind): ColumnType` — varchar → length 255, numeric → precision 10 scale 2
  - `formatColumnType(type: ColumnType): string` — `varchar(120)`, `numeric(10,2)`, or the kind
  - `setVarcharLength(type, value: number): ColumnType`, `setNumericPrecision(type, value): ColumnType`, `setNumericScale(type, value): ColumnType` — clamp to the valid range, truncate to an integer, treat non-finite as the minimum, return `type` unchanged when its kind does not match; lowering the precision lowers the scale with it
- Produces (`lib/project-view.ts`):
  - `NodePosition { x; y }`, `Viewport { x; y; zoom }`, `ProjectView { nodes: Record<TableId, NodePosition>; viewport: Viewport }`
  - `DEFAULT_VIEWPORT`, `createView(): ProjectView`
  - `nextNodePosition(existingCount: number): NodePosition` — a three-column grid starting at (40, 40), 320 px apart horizontally and 260 px vertically
  - `parseView(input: unknown): ProjectView` — tolerant: anything malformed falls back to defaults, entries with non-finite coordinates are dropped

- [ ] **Step 1: Prove the web tests can import `@forge/core`**

Run: `cd apps/web && node -e "import('@forge/core').then((m) => console.log(typeof m.generateDdl))"`
Expected: prints `function`. If it prints `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` or `ERR_UNKNOWN_FILE_EXTENSION`, stop and report: every later web test depends on this import working.

- [ ] **Step 2: Install TanStack Query**

```bash
pnpm --filter @forge/web add @tanstack/react-query
```
Expected: `@tanstack/react-query` appears under `dependencies` in `apps/web/package.json` with a caret range.

- [ ] **Step 3: Write the failing tests for the column-type helpers**

Create `apps/web/src/tests/unit/lib/column-types.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MAX_NUMERIC_PRECISION, MAX_VARCHAR_LENGTH } from '@forge/core'

import {
  COLUMN_KINDS,
  defaultColumnType,
  formatColumnType,
  setNumericPrecision,
  setNumericScale,
  setVarcharLength,
} from '../../../lib/column-types.ts'

describe('COLUMN_KINDS', () => {
  it('lists the simple kinds, then varchar and numeric', () => {
    assert.deepEqual(
      [...COLUMN_KINDS],
      [
        'integer',
        'bigint',
        'text',
        'boolean',
        'uuid',
        'timestamp',
        'date',
        'json',
        'varchar',
        'numeric',
      ]
    )
  })
})

describe('defaultColumnType', () => {
  it('returns a parameterless type for simple kinds', () => {
    assert.deepEqual(defaultColumnType('uuid'), { kind: 'uuid' })
  })

  it('returns usable defaults for varchar and numeric', () => {
    assert.deepEqual(defaultColumnType('varchar'), {
      kind: 'varchar',
      length: 255,
    })
    assert.deepEqual(defaultColumnType('numeric'), {
      kind: 'numeric',
      precision: 10,
      scale: 2,
    })
  })
})

describe('formatColumnType', () => {
  it('formats parameterized and simple types', () => {
    assert.equal(formatColumnType({ kind: 'varchar', length: 120 }), 'varchar(120)')
    assert.equal(
      formatColumnType({ kind: 'numeric', precision: 10, scale: 2 }),
      'numeric(10,2)'
    )
    assert.equal(formatColumnType({ kind: 'timestamp' }), 'timestamp')
  })
})

describe('setVarcharLength', () => {
  const type = { kind: 'varchar', length: 50 } as const

  it('sets a valid length', () => {
    assert.deepEqual(setVarcharLength(type, 120), { kind: 'varchar', length: 120 })
  })

  it('truncates and clamps to the valid range', () => {
    assert.deepEqual(setVarcharLength(type, 12.7), { kind: 'varchar', length: 12 })
    assert.deepEqual(setVarcharLength(type, 0), { kind: 'varchar', length: 1 })
    assert.deepEqual(setVarcharLength(type, -5), { kind: 'varchar', length: 1 })
    assert.deepEqual(setVarcharLength(type, MAX_VARCHAR_LENGTH + 1), {
      kind: 'varchar',
      length: MAX_VARCHAR_LENGTH,
    })
    assert.deepEqual(setVarcharLength(type, Number.NaN), {
      kind: 'varchar',
      length: 1,
    })
  })

  it('leaves a type of another kind untouched', () => {
    const other = { kind: 'text' } as const
    assert.equal(setVarcharLength(other, 10), other)
  })
})

describe('setNumericPrecision', () => {
  const type = { kind: 'numeric', precision: 10, scale: 4 } as const

  it('sets the precision and keeps the scale when it still fits', () => {
    assert.deepEqual(setNumericPrecision(type, 12), {
      kind: 'numeric',
      precision: 12,
      scale: 4,
    })
  })

  it('lowers the scale together with the precision', () => {
    assert.deepEqual(setNumericPrecision(type, 3), {
      kind: 'numeric',
      precision: 3,
      scale: 3,
    })
  })

  it('clamps to the valid range', () => {
    assert.deepEqual(setNumericPrecision(type, 0), {
      kind: 'numeric',
      precision: 1,
      scale: 1,
    })
    assert.deepEqual(setNumericPrecision(type, MAX_NUMERIC_PRECISION + 1), {
      kind: 'numeric',
      precision: MAX_NUMERIC_PRECISION,
      scale: 4,
    })
  })

  it('leaves a type of another kind untouched', () => {
    const other = { kind: 'integer' } as const
    assert.equal(setNumericPrecision(other, 5), other)
  })
})

describe('setNumericScale', () => {
  const type = { kind: 'numeric', precision: 10, scale: 2 } as const

  it('sets a valid scale', () => {
    assert.deepEqual(setNumericScale(type, 5), {
      kind: 'numeric',
      precision: 10,
      scale: 5,
    })
  })

  it('clamps between zero and the precision', () => {
    assert.deepEqual(setNumericScale(type, -1), {
      kind: 'numeric',
      precision: 10,
      scale: 0,
    })
    assert.deepEqual(setNumericScale(type, 99), {
      kind: 'numeric',
      precision: 10,
      scale: 10,
    })
  })

  it('leaves a type of another kind untouched', () => {
    const other = { kind: 'text' } as const
    assert.equal(setNumericScale(other, 1), other)
  })
})
```

- [ ] **Step 4: Run the tests and verify they fail**

Run: `cd apps/web && node --test src/tests/unit/lib/column-types.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `lib/column-types.ts`.

- [ ] **Step 5: Implement the column-type helpers**

Create `apps/web/src/lib/column-types.ts`:

```ts
import {
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
  SIMPLE_COLUMN_KINDS,
} from '@forge/core'
import type { ColumnType } from '@forge/core'

export const COLUMN_KINDS = [
  ...SIMPLE_COLUMN_KINDS,
  'varchar',
  'numeric',
] as const

export type ColumnKind = (typeof COLUMN_KINDS)[number]

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export function defaultColumnType(kind: ColumnKind): ColumnType {
  switch (kind) {
    case 'varchar':
      return { kind: 'varchar', length: 255 }
    case 'numeric':
      return { kind: 'numeric', precision: 10, scale: 2 }
    default:
      return { kind }
  }
}

export function formatColumnType(type: ColumnType): string {
  switch (type.kind) {
    case 'varchar':
      return `varchar(${type.length})`
    case 'numeric':
      return `numeric(${type.precision},${type.scale})`
    default:
      return type.kind
  }
}

export function setVarcharLength(type: ColumnType, value: number): ColumnType {
  if (type.kind !== 'varchar') return type
  return { kind: 'varchar', length: clamp(value, 1, MAX_VARCHAR_LENGTH) }
}

export function setNumericPrecision(
  type: ColumnType,
  value: number
): ColumnType {
  if (type.kind !== 'numeric') return type
  const precision = clamp(value, 1, MAX_NUMERIC_PRECISION)
  return { kind: 'numeric', precision, scale: Math.min(type.scale, precision) }
}

export function setNumericScale(type: ColumnType, value: number): ColumnType {
  if (type.kind !== 'numeric') return type
  return {
    kind: 'numeric',
    precision: type.precision,
    scale: clamp(value, 0, type.precision),
  }
}
```

- [ ] **Step 6: Run the tests and verify they pass**

Run: `cd apps/web && node --test src/tests/unit/lib/column-types.test.ts`
Expected: PASS — 14 tests, 0 failures.

- [ ] **Step 7: Write the failing tests for the project view**

Create `apps/web/src/tests/unit/lib/project-view.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_VIEWPORT,
  createView,
  nextNodePosition,
  parseView,
} from '../../../lib/project-view.ts'

describe('createView', () => {
  it('starts with no nodes and the default viewport', () => {
    assert.deepEqual(createView(), { nodes: {}, viewport: DEFAULT_VIEWPORT })
  })
})

describe('nextNodePosition', () => {
  it('fills a three-column grid row by row', () => {
    assert.deepEqual(nextNodePosition(0), { x: 40, y: 40 })
    assert.deepEqual(nextNodePosition(1), { x: 360, y: 40 })
    assert.deepEqual(nextNodePosition(2), { x: 680, y: 40 })
    assert.deepEqual(nextNodePosition(3), { x: 40, y: 300 })
  })
})

describe('parseView', () => {
  it('reads a valid view', () => {
    const view = {
      nodes: { t1: { x: 5, y: 6 } },
      viewport: { x: 1, y: 2, zoom: 1.5 },
    }
    assert.deepEqual(parseView(view), view)
  })

  it('falls back to the default view for anything that is not an object', () => {
    for (const input of [null, undefined, 5, 'text', [], true]) {
      assert.deepEqual(parseView(input), createView())
    }
  })

  it('drops node entries with invalid coordinates', () => {
    const view = parseView({
      nodes: {
        ok: { x: 1, y: 2 },
        missing: { x: 1 },
        text: { x: '1', y: 2 },
        nan: { x: Number.NaN, y: 0 },
        wrong: 7,
      },
    })
    assert.deepEqual(Object.keys(view.nodes), ['ok'])
  })

  it('falls back to the default viewport when it is invalid', () => {
    assert.deepEqual(
      parseView({ viewport: { x: 0, y: 0, zoom: 0 } }).viewport,
      DEFAULT_VIEWPORT
    )
    assert.deepEqual(
      parseView({ viewport: { x: Number.NaN, y: 0, zoom: 1 } }).viewport,
      DEFAULT_VIEWPORT
    )
    assert.deepEqual(parseView({ viewport: 'x' }).viewport, DEFAULT_VIEWPORT)
  })

  it('does not let a "__proto__" key change the prototype of the nodes', () => {
    const parsed = parseView(
      JSON.parse('{"nodes":{"__proto__":{"x":1,"y":2},"t":{"x":3,"y":4}}}')
    )
    assert.equal(Object.getPrototypeOf(parsed.nodes), Object.prototype)
    assert.deepEqual(Object.keys(parsed.nodes).sort(), ['__proto__', 't'])
  })
})
```

- [ ] **Step 8: Run them and verify they fail**

Run: `cd apps/web && node --test src/tests/unit/lib/project-view.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `lib/project-view.ts`.

- [ ] **Step 9: Implement the project view**

Create `apps/web/src/lib/project-view.ts`:

```ts
import type { TableId } from '@forge/core'

export interface NodePosition {
  x: number
  y: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** What the web stores in the opaque `view` slot of the saved project. */
export interface ProjectView {
  nodes: Record<TableId, NodePosition>
  viewport: Viewport
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

export function createView(): ProjectView {
  return { nodes: {}, viewport: DEFAULT_VIEWPORT }
}

/** Where the Nth new table node goes: a three-column grid. */
export function nextNodePosition(existingCount: number): NodePosition {
  return {
    x: 40 + (existingCount % 3) * 320,
    y: 40 + Math.floor(existingCount / 3) * 260,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function parsePosition(raw: unknown): NodePosition | null {
  if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
    return null
  }
  return { x: raw.x, y: raw.y }
}

function parseViewport(raw: unknown): Viewport {
  if (
    isRecord(raw) &&
    isFiniteNumber(raw.x) &&
    isFiniteNumber(raw.y) &&
    isFiniteNumber(raw.zoom) &&
    raw.zoom > 0
  ) {
    return { x: raw.x, y: raw.y, zoom: raw.zoom }
  }
  return DEFAULT_VIEWPORT
}

/**
 * Reads the opaque `view` of a saved project. The view is cosmetic, so a
 * malformed one is replaced by defaults instead of failing the whole load.
 */
export function parseView(input: unknown): ProjectView {
  if (!isRecord(input)) return createView()

  const entries: [string, NodePosition][] = []
  if (isRecord(input.nodes)) {
    for (const [tableId, raw] of Object.entries(input.nodes)) {
      const position = parsePosition(raw)
      if (position) entries.push([tableId, position])
    }
  }

  // fromEntries defines own properties, so a table id of "__proto__" cannot
  // reach the prototype the way `nodes[id] = position` could.
  return {
    nodes: Object.fromEntries(entries),
    viewport: parseViewport(input.viewport),
  }
}
```

- [ ] **Step 10: Run them and verify they pass**

Run: `cd apps/web && node --test src/tests/unit/lib/project-view.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 11: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm typecheck && pnpm test
git add apps/web/package.json pnpm-lock.yaml apps/web/src
git commit -m "feat(web): add column-type helpers, project view and TanStack Query

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web — storage adapter and `loadProject` / `saveProject`

**Files:**
- Create: `apps/web/src/lib/describe-error.ts`
- Create: `apps/web/src/lib/storage/project-storage.ts`
- Create: `apps/web/src/lib/storage/local-storage-adapter.ts`
- Create: `apps/web/src/lib/storage/default-storage.ts`
- Create: `apps/web/src/queries/project/load-project.ts`
- Create: `apps/web/src/queries/project/save-project.ts`
- Create: `apps/web/src/tests/helpers/memory-storage.ts`
- Test: `apps/web/src/tests/unit/lib/storage/local-storage-adapter.test.ts`
- Test: `apps/web/src/tests/integration/project/load.test.ts`
- Test: `apps/web/src/tests/integration/project/save.test.ts`

**Interfaces:**
- Consumes: from `@forge/core` — `Project`, `ParseError`, `parseProject`, `createProject`, `createSchema`, `addTable`.
- Produces:
  - `describeError(error: unknown): string`
  - `ProjectStorage { read(): string | null; write(value: string): void }` — both may throw; `StorageLike { getItem(key): string | null; setItem(key, value): void }`; `PROJECT_STORAGE_KEY = 'forge:project'`
  - `createLocalStorageAdapter(getStorage: () => StorageLike): ProjectStorage` — never touches the storage until `read`/`write` is called
  - `localStorageProject: ProjectStorage` (default instance over `globalThis.localStorage`)
  - `LoadResult = { status: 'empty' } | { status: 'loaded'; project: Project } | { status: 'invalid'; errors: ParseError[] } | { status: 'unavailable'; message: string }`
  - `loadProject(storage: ProjectStorage): LoadResult` — never throws, never writes
  - `SaveResult = { ok: true } | { ok: false; message: string }`
  - `saveProject(storage: ProjectStorage, project: Project): SaveResult` — never throws
  - Test helpers: `memoryStorage(initial?)` with `peek()`, `brokenStorage(message)` (read and write throw), `quotaStorage(initial, message)` (read works, write throws)

- [ ] **Step 1: Write the test helpers**

Create `apps/web/src/tests/helpers/memory-storage.ts`:

```ts
import type { ProjectStorage } from '../../lib/storage/project-storage.ts'

export interface MemoryStorage extends ProjectStorage {
  /** The stored value, without going through `read`. */
  peek(): string | null
}

export function memoryStorage(initial: string | null = null): MemoryStorage {
  let value = initial
  return {
    read: () => value,
    write: (next) => {
      value = next
    },
    peek: () => value,
  }
}

/** Both `read` and `write` throw, like storage that is blocked outright. */
export function brokenStorage(message: string): ProjectStorage {
  const fail = (): never => {
    throw new Error(message)
  }
  return { read: fail, write: fail }
}

/** `read` works and `write` throws, like a full `localStorage`. */
export function quotaStorage(
  initial: string | null,
  message: string
): MemoryStorage {
  return {
    read: () => initial,
    write: () => {
      throw new Error(message)
    },
    peek: () => initial,
  }
}
```

- [ ] **Step 2: Write the failing adapter test**

Create `apps/web/src/tests/unit/lib/storage/local-storage-adapter.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createLocalStorageAdapter } from '../../../../lib/storage/local-storage-adapter.ts'
import {
  PROJECT_STORAGE_KEY,
  type StorageLike,
} from '../../../../lib/storage/project-storage.ts'

function fakeStorage() {
  const data = new Map<string, string>()
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
  return { data, storage }
}

describe('createLocalStorageAdapter', () => {
  it('reads and writes under the forge:project key', () => {
    const { data, storage } = fakeStorage()
    const adapter = createLocalStorageAdapter(() => storage)

    assert.equal(PROJECT_STORAGE_KEY, 'forge:project')
    assert.equal(adapter.read(), null)
    adapter.write('{"a":1}')
    assert.equal(data.get('forge:project'), '{"a":1}')
    assert.equal(adapter.read(), '{"a":1}')
  })

  it('does not touch the storage until it is used', () => {
    let touched = false
    createLocalStorageAdapter(() => {
      touched = true
      return fakeStorage().storage
    })
    assert.equal(touched, false)
  })

  it('lets an error thrown by the storage propagate', () => {
    const adapter = createLocalStorageAdapter(() => {
      throw new Error('SecurityError')
    })
    assert.throws(() => adapter.read(), /SecurityError/)
    assert.throws(() => adapter.write('x'), /SecurityError/)
  })
})
```

- [ ] **Step 3: Run it and verify it fails**

Run: `cd apps/web && node --test src/tests/unit/lib/storage/local-storage-adapter.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `local-storage-adapter.ts`.

- [ ] **Step 4: Implement the storage layer**

Create `apps/web/src/lib/describe-error.ts`:

```ts
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

Create `apps/web/src/lib/storage/project-storage.ts`:

```ts
export const PROJECT_STORAGE_KEY = 'forge:project'

/** Where the serialized project lives. Both methods may throw. */
export interface ProjectStorage {
  read(): string | null
  write(value: string): void
}

/** The part of the Web Storage API the adapter needs. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
```

Create `apps/web/src/lib/storage/local-storage-adapter.ts`:

```ts
import { PROJECT_STORAGE_KEY } from './project-storage.ts'
import type { ProjectStorage, StorageLike } from './project-storage.ts'

/**
 * Takes a getter, not the storage itself: reaching for `localStorage` can throw
 * (blocked cookies, private modes), and that must happen inside `read`/`write`
 * where `loadProject`/`saveProject` catch it, not while the app starts.
 */
export function createLocalStorageAdapter(
  getStorage: () => StorageLike
): ProjectStorage {
  return {
    read: () => getStorage().getItem(PROJECT_STORAGE_KEY),
    write: (value) => getStorage().setItem(PROJECT_STORAGE_KEY, value),
  }
}
```

Create `apps/web/src/lib/storage/default-storage.ts`:

```ts
import { createLocalStorageAdapter } from './local-storage-adapter.ts'

export const localStorageProject = createLocalStorageAdapter(
  () => globalThis.localStorage
)
```

- [ ] **Step 5: Run the adapter test and verify it passes**

Run: `cd apps/web && node --test src/tests/unit/lib/storage/local-storage-adapter.test.ts`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 6: Write the failing integration tests for load and save**

Create `apps/web/src/tests/integration/project/load.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addTable, createProject, createSchema } from '@forge/core'

import { loadProject } from '../../../queries/project/load-project.ts'
import { saveProject } from '../../../queries/project/save-project.ts'
import { brokenStorage, memoryStorage } from '../../helpers/memory-storage.ts'

const schema = addTable(createSchema(), { id: 't1', name: 'users' })
const view = { nodes: { t1: { x: 1, y: 2 } } }

describe('loadProject', () => {
  it('reports an empty storage', () => {
    assert.deepEqual(loadProject(memoryStorage()), { status: 'empty' })
  })

  it('loads what saveProject stored', () => {
    const storage = memoryStorage()
    assert.deepEqual(saveProject(storage, createProject(schema, view)), {
      ok: true,
    })
    assert.deepEqual(loadProject(storage), {
      status: 'loaded',
      project: createProject(schema, view),
    })
  })

  it('reports text that is not JSON', () => {
    const result = loadProject(memoryStorage('{ not json'))
    assert.equal(result.status, 'invalid')
    assert.ok(result.status === 'invalid')
    assert.match(result.errors[0]?.message ?? '', /JSON/)
  })

  it('reports JSON that came from another app', () => {
    const result = loadProject(memoryStorage('{"hello":"world"}'))
    assert.ok(result.status === 'invalid')
    assert.match(result.errors[0]?.message ?? '', /format version/)
  })

  it('reports a project written by a newer version of the app', () => {
    const newer = JSON.stringify({ ...createProject(schema, view), formatVersion: 2 })
    const result = loadProject(memoryStorage(newer))
    assert.ok(result.status === 'invalid')
    assert.match(result.errors[0]?.message ?? '', /version 2/)
  })

  it('reports a relationship that points at a deleted table', () => {
    const broken = JSON.stringify({
      ...createProject(schema, view),
      schema: {
        ...schema,
        relationships: [
          {
            id: 'r',
            from: { tableId: 't1', columnId: 'c' },
            to: { tableId: 'gone', columnId: 'c' },
          },
        ],
      },
    })
    const result = loadProject(memoryStorage(broken))
    assert.ok(result.status === 'invalid')
    assert.ok(result.errors[0]?.path.startsWith('schema.relationships'))
  })

  it('reports storage that cannot be read', () => {
    const result = loadProject(brokenStorage('SecurityError: blocked'))
    assert.deepEqual(result, {
      status: 'unavailable',
      message: 'SecurityError: blocked',
    })
  })

  it('never modifies the stored value, even when it is invalid', () => {
    const raw = '{"hello":"world"}'
    const storage = memoryStorage(raw)
    loadProject(storage)
    assert.equal(storage.peek(), raw)
  })
})
```

Create `apps/web/src/tests/integration/project/save.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  addTable,
  createProject,
  createSchema,
  parseProject,
} from '@forge/core'

import { saveProject } from '../../../queries/project/save-project.ts'
import {
  brokenStorage,
  memoryStorage,
  quotaStorage,
} from '../../helpers/memory-storage.ts'

const project = createProject(
  addTable(createSchema(), { id: 't1', name: 'users' }),
  { nodes: { t1: { x: 1, y: 2 } } }
)

describe('saveProject', () => {
  it('stores JSON that the core can parse back unchanged', () => {
    const storage = memoryStorage()
    assert.deepEqual(saveProject(storage, project), { ok: true })
    const stored = storage.peek()
    assert.ok(stored !== null)
    const parsed = parseProject(JSON.parse(stored))
    assert.ok(parsed.ok)
    assert.deepEqual(parsed.project, project)
  })

  it('reports a write that fails, such as a full storage', () => {
    const storage = quotaStorage('previous', 'QuotaExceededError')
    assert.deepEqual(saveProject(storage, project), {
      ok: false,
      message: 'QuotaExceededError',
    })
    assert.equal(storage.peek(), 'previous')
  })

  it('reports storage that is blocked outright', () => {
    assert.deepEqual(saveProject(brokenStorage('SecurityError'), project), {
      ok: false,
      message: 'SecurityError',
    })
  })
})
```

- [ ] **Step 7: Run them and verify they fail**

Run: `cd apps/web && node --test src/tests/integration/project/load.test.ts src/tests/integration/project/save.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `load-project.ts`.

- [ ] **Step 8: Implement `loadProject` and `saveProject`**

Create `apps/web/src/queries/project/load-project.ts`:

```ts
import { parseProject } from '@forge/core'
import type { ParseError, Project } from '@forge/core'

import { describeError } from '../../lib/describe-error.ts'
import type { ProjectStorage } from '../../lib/storage/project-storage.ts'

export type LoadResult =
  | { status: 'empty' }
  | { status: 'loaded'; project: Project }
  | { status: 'invalid'; errors: ParseError[] }
  | { status: 'unavailable'; message: string }

/** Reads and validates the stored project. Never throws and never writes. */
export function loadProject(storage: ProjectStorage): LoadResult {
  let raw: string | null
  try {
    raw = storage.read()
  } catch (error) {
    return { status: 'unavailable', message: describeError(error) }
  }
  if (raw === null) return { status: 'empty' }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return {
      status: 'invalid',
      errors: [{ path: '', message: 'The stored project is not valid JSON.' }],
    }
  }

  const result = parseProject(json)
  return result.ok
    ? { status: 'loaded', project: result.project }
    : { status: 'invalid', errors: result.errors }
}
```

Create `apps/web/src/queries/project/save-project.ts`:

```ts
import type { Project } from '@forge/core'

import { describeError } from '../../lib/describe-error.ts'
import type { ProjectStorage } from '../../lib/storage/project-storage.ts'

export type SaveResult = { ok: true } | { ok: false; message: string }

/** Serializes and stores the project. Never throws. */
export function saveProject(
  storage: ProjectStorage,
  project: Project
): SaveResult {
  try {
    storage.write(JSON.stringify(project))
    return { ok: true }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}
```

- [ ] **Step 9: Run them and verify they pass**

Run: `cd apps/web && node --test src/tests/integration/project/load.test.ts src/tests/integration/project/save.test.ts`
Expected: PASS — 11 tests (8 load, 3 save), 0 failures.

- [ ] **Step 10: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): add the localStorage adapter and load/save project functions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Web — the Zustand store

**Files:**
- Create: `apps/web/src/lib/store/forge-store.ts`
- Test: `apps/web/src/tests/unit/lib/store/forge-store.test.ts`

**Interfaces:**
- Consumes: `@forge/core` (all operations, `checkRelationship`, types, `createProject`); `LoadResult` from `queries/project/load-project.ts`; `createView`, `nextNodePosition`, `parseView`, `NodePosition`, `ProjectView`, `Viewport` from `lib/project-view.ts`.
- Produces (`lib/store/forge-store.ts`):
  - `PersistenceMode = 'ready' | 'blocked'`, `StartupNotice = { kind: 'invalid'; errors: ParseError[] } | { kind: 'unavailable'; message: string }`
  - `ForgeState` — fields `schema`, `view`, `selection: TableId | null`, `hydrated: boolean`, `persistence`, `notice: StartupNotice | null`; actions:
    - `hydrate(result: LoadResult): void` — `loaded`/`empty` → ready; `invalid` → empty project in memory, `persistence: 'blocked'`, notice; `unavailable` → empty project, ready, notice
    - `startNewProject(): void` — empty project, ready, no notice
    - `addTable(): TableId` — generated id, name `table_N` (first unused), position `nextNodePosition(count)`, becomes the selection
    - `renameTable(tableId, name)`, `removeTable(tableId)` (also drops its position, clears the selection if it was selected)
    - `addColumn(tableId): ColumnId | null` — name `column_N`, type `text`, nullable; `null` for an unknown table
    - `updateColumn(tableId, columnId, patch)`, `removeColumn(tableId, columnId)`, `setPrimaryKey(tableId, columnIds)`
    - `connect(from: ColumnRef, to: ColumnRef): Issue | null` — adds the relationship, or returns the issue and changes nothing
    - `removeRelationship(relationshipId)`, `moveNode(tableId, position)`, `setViewport(viewport)`, `select(tableId | null)`
  - `ForgeStoreDeps { newId: () => string }`, `createForgeStore(deps)` returning a vanilla Zustand `StoreApi<ForgeState>`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/tests/unit/lib/store/forge-store.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addTable, createProject, createSchema } from '@forge/core'

import { createView, nextNodePosition } from '../../../../lib/project-view.ts'
import { createForgeStore } from '../../../../lib/store/forge-store.ts'

function makeStore() {
  let counter = 0
  return createForgeStore({ newId: () => `id-${++counter}` })
}

type TestStore = ReturnType<typeof makeStore>

function must<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'expected a value')
  return value
}

/** users(id uuid, primary key) and orders(user_id uuid). */
function withUsersAndOrders(store: TestStore) {
  const state = () => store.getState()
  const users = state().addTable()
  const usersId = must(state().addColumn(users))
  state().updateColumn(users, usersId, { name: 'id', type: { kind: 'uuid' } })
  state().setPrimaryKey(users, [usersId])
  const orders = state().addTable()
  const ordersUser = must(state().addColumn(orders))
  state().updateColumn(orders, ordersUser, {
    name: 'user_id',
    type: { kind: 'uuid' },
  })
  return { users, usersId, orders, ordersUser }
}

describe('initial state', () => {
  it('starts empty, not hydrated, ready to persist', () => {
    const state = makeStore().getState()
    assert.deepEqual(state.schema, createSchema())
    assert.deepEqual(state.view, createView())
    assert.equal(state.selection, null)
    assert.equal(state.hydrated, false)
    assert.equal(state.persistence, 'ready')
    assert.equal(state.notice, null)
  })
})

describe('hydrate', () => {
  it('starts an empty project when nothing was stored', () => {
    const store = makeStore()
    store.getState().hydrate({ status: 'empty' })
    assert.equal(store.getState().hydrated, true)
    assert.equal(store.getState().persistence, 'ready')
    assert.deepEqual(store.getState().schema, createSchema())
  })

  it('restores the schema and the view of a loaded project', () => {
    const store = makeStore()
    const schema = addTable(createSchema(), { id: 't1', name: 'users' })
    const view = {
      nodes: { t1: { x: 5, y: 6 } },
      viewport: { x: 1, y: 2, zoom: 3 },
    }
    store.getState().hydrate({
      status: 'loaded',
      project: createProject(schema, view),
    })
    const state = store.getState()
    assert.deepEqual(state.schema, schema)
    assert.deepEqual(state.view, view)
    assert.equal(state.persistence, 'ready')
    assert.equal(state.notice, null)
  })

  it('uses a default view when the stored view is malformed', () => {
    const store = makeStore()
    store.getState().hydrate({
      status: 'loaded',
      project: createProject(createSchema(), 'garbage'),
    })
    assert.deepEqual(store.getState().view, createView())
  })

  it('blocks persistence when the stored project is invalid', () => {
    const store = makeStore()
    const errors = [{ path: 'schema', message: 'broken' }]
    store.getState().hydrate({ status: 'invalid', errors })
    const state = store.getState()
    assert.equal(state.hydrated, true)
    assert.equal(state.persistence, 'blocked')
    assert.deepEqual(state.notice, { kind: 'invalid', errors })
    assert.deepEqual(state.schema, createSchema())
  })

  it('keeps persistence on, with a notice, when storage is unavailable', () => {
    const store = makeStore()
    store.getState().hydrate({ status: 'unavailable', message: 'blocked' })
    assert.equal(store.getState().persistence, 'ready')
    assert.deepEqual(store.getState().notice, {
      kind: 'unavailable',
      message: 'blocked',
    })
  })

  it('startNewProject clears the block and the notice', () => {
    const store = makeStore()
    store.getState().hydrate({
      status: 'invalid',
      errors: [{ path: '', message: 'broken' }],
    })
    store.getState().startNewProject()
    assert.equal(store.getState().persistence, 'ready')
    assert.equal(store.getState().notice, null)
  })
})

describe('tables', () => {
  it('addTable names, places and selects the new table', () => {
    const store = makeStore()
    const first = store.getState().addTable()
    const second = store.getState().addTable()
    const state = store.getState()
    assert.deepEqual(
      state.schema.tables.map((table) => table.name),
      ['table_1', 'table_2']
    )
    assert.deepEqual(state.view.nodes[first], nextNodePosition(0))
    assert.deepEqual(state.view.nodes[second], nextNodePosition(1))
    assert.equal(state.selection, second)
  })

  it('addTable skips names that are already taken', () => {
    const store = makeStore()
    const first = store.getState().addTable()
    store.getState().renameTable(first, 'table_2')
    store.getState().addTable()
    assert.equal(store.getState().schema.tables[1]?.name, 'table_3')
  })

  it('renameTable keeps the other tables by reference', () => {
    const store = makeStore()
    const first = store.getState().addTable()
    store.getState().addTable()
    const before = store.getState().schema.tables[1]
    store.getState().renameTable(first, 'people')
    assert.equal(store.getState().schema.tables[0]?.name, 'people')
    assert.equal(store.getState().schema.tables[1], before)
  })

  it('removeTable drops the table, its position and its relationships', () => {
    const store = makeStore()
    const { users, usersId, orders, ordersUser } = withUsersAndOrders(store)
    store.getState().connect(
      { tableId: orders, columnId: ordersUser },
      { tableId: users, columnId: usersId }
    )
    store.getState().removeTable(users)
    const state = store.getState()
    assert.equal(state.schema.tables.length, 1)
    assert.equal(state.schema.relationships.length, 0)
    assert.equal(state.view.nodes[users], undefined)
  })

  it('removeTable clears the selection only when it was the selected table', () => {
    const store = makeStore()
    const first = store.getState().addTable()
    const second = store.getState().addTable()
    store.getState().removeTable(first)
    assert.equal(store.getState().selection, second)
    store.getState().removeTable(second)
    assert.equal(store.getState().selection, null)
  })
})

describe('columns', () => {
  it('addColumn adds a nullable text column named column_N', () => {
    const store = makeStore()
    const table = store.getState().addTable()
    const columnId = must(store.getState().addColumn(table))
    assert.deepEqual(store.getState().schema.tables[0]?.columns, [
      { id: columnId, name: 'column_1', type: { kind: 'text' }, nullable: true },
    ])
    store.getState().addColumn(table)
    assert.equal(store.getState().schema.tables[0]?.columns[1]?.name, 'column_2')
  })

  it('addColumn returns null and changes nothing for an unknown table', () => {
    const store = makeStore()
    const before = store.getState().schema
    assert.equal(store.getState().addColumn('nope'), null)
    assert.equal(store.getState().schema, before)
  })

  it('updateColumn, setPrimaryKey and removeColumn go through the core', () => {
    const store = makeStore()
    const table = store.getState().addTable()
    const columnId = must(store.getState().addColumn(table))
    store.getState().updateColumn(table, columnId, { name: 'id', nullable: false })
    store.getState().setPrimaryKey(table, [columnId])
    assert.equal(store.getState().schema.tables[0]?.columns[0]?.name, 'id')
    assert.deepEqual(store.getState().schema.tables[0]?.primaryKey, [columnId])
    store.getState().removeColumn(table, columnId)
    assert.deepEqual(store.getState().schema.tables[0]?.columns, [])
    assert.deepEqual(store.getState().schema.tables[0]?.primaryKey, [])
  })
})

describe('relationships', () => {
  it('connect adds an allowed relationship and returns null', () => {
    const store = makeStore()
    const { users, usersId, orders, ordersUser } = withUsersAndOrders(store)
    const issue = store.getState().connect(
      { tableId: orders, columnId: ordersUser },
      { tableId: users, columnId: usersId }
    )
    assert.equal(issue, null)
    assert.equal(store.getState().schema.relationships.length, 1)
  })

  it('connect returns the issue and changes nothing for a forbidden one', () => {
    const store = makeStore()
    const { users, usersId, orders, ordersUser } = withUsersAndOrders(store)
    store.getState().updateColumn(orders, ordersUser, { type: { kind: 'text' } })
    const before = store.getState().schema
    const issue = store.getState().connect(
      { tableId: orders, columnId: ordersUser },
      { tableId: users, columnId: usersId }
    )
    assert.equal(issue?.code, 'relationship-type-mismatch')
    assert.equal(store.getState().schema, before)
  })

  it('removeRelationship removes it by id', () => {
    const store = makeStore()
    const { users, usersId, orders, ordersUser } = withUsersAndOrders(store)
    store.getState().connect(
      { tableId: orders, columnId: ordersUser },
      { tableId: users, columnId: usersId }
    )
    const relationshipId = must(store.getState().schema.relationships[0]?.id)
    store.getState().removeRelationship(relationshipId)
    assert.equal(store.getState().schema.relationships.length, 0)
  })
})

describe('view and selection', () => {
  it('moveNode updates one position and leaves the schema untouched', () => {
    const store = makeStore()
    const table = store.getState().addTable()
    const schema = store.getState().schema
    store.getState().moveNode(table, { x: 100, y: 200 })
    assert.deepEqual(store.getState().view.nodes[table], { x: 100, y: 200 })
    assert.equal(store.getState().schema, schema)
  })

  it('setViewport and select update their own slices', () => {
    const store = makeStore()
    const table = store.getState().addTable()
    store.getState().setViewport({ x: 1, y: 2, zoom: 1.5 })
    store.getState().select(null)
    assert.deepEqual(store.getState().view.viewport, { x: 1, y: 2, zoom: 1.5 })
    assert.equal(store.getState().selection, null)
    store.getState().select(table)
    assert.equal(store.getState().selection, table)
  })
})
```

- [ ] **Step 2: Run them and verify they fail**

Run: `cd apps/web && node --test src/tests/unit/lib/store/forge-store.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `lib/store/forge-store.ts`.

- [ ] **Step 3: Implement the store**

Create `apps/web/src/lib/store/forge-store.ts`:

```ts
import * as core from '@forge/core'
import type {
  Column,
  ColumnId,
  ColumnRef,
  Issue,
  ParseError,
  RelationshipId,
  Schema,
  TableId,
} from '@forge/core'
import { createStore } from 'zustand/vanilla'

import type { LoadResult } from '../../queries/project/load-project.ts'
import { createView, nextNodePosition, parseView } from '../project-view.ts'
import type { NodePosition, ProjectView, Viewport } from '../project-view.ts'

/** `blocked` means the stored project could not be read: do not overwrite it. */
export type PersistenceMode = 'ready' | 'blocked'

export type StartupNotice =
  | { kind: 'invalid'; errors: ParseError[] }
  | { kind: 'unavailable'; message: string }

export interface ForgeState {
  schema: Schema
  view: ProjectView
  selection: TableId | null
  hydrated: boolean
  persistence: PersistenceMode
  notice: StartupNotice | null

  hydrate: (result: LoadResult) => void
  startNewProject: () => void

  addTable: () => TableId
  renameTable: (tableId: TableId, name: string) => void
  removeTable: (tableId: TableId) => void

  addColumn: (tableId: TableId) => ColumnId | null
  updateColumn: (
    tableId: TableId,
    columnId: ColumnId,
    patch: Partial<Omit<Column, 'id'>>
  ) => void
  removeColumn: (tableId: TableId, columnId: ColumnId) => void
  setPrimaryKey: (tableId: TableId, columnIds: ColumnId[]) => void

  connect: (from: ColumnRef, to: ColumnRef) => Issue | null
  removeRelationship: (relationshipId: RelationshipId) => void

  moveNode: (tableId: TableId, position: NodePosition) => void
  setViewport: (viewport: Viewport) => void
  select: (tableId: TableId | null) => void
}

export interface ForgeStoreDeps {
  /** Produces a fresh id. The web passes `crypto.randomUUID`. */
  newId: () => string
}

const emptyProject = () => ({
  schema: core.createSchema(),
  view: createView(),
  selection: null,
})

function nextName(prefix: string, taken: string[]): string {
  let attempt = taken.length + 1
  while (taken.includes(`${prefix}_${attempt}`)) attempt++
  return `${prefix}_${attempt}`
}

export function createForgeStore({ newId }: ForgeStoreDeps) {
  return createStore<ForgeState>()((set, get) => ({
    ...emptyProject(),
    hydrated: false,
    persistence: 'ready',
    notice: null,

    hydrate: (result) => {
      switch (result.status) {
        case 'loaded':
          set({
            schema: result.project.schema,
            view: parseView(result.project.view),
            selection: null,
            hydrated: true,
            persistence: 'ready',
            notice: null,
          })
          break
        case 'empty':
          set({
            ...emptyProject(),
            hydrated: true,
            persistence: 'ready',
            notice: null,
          })
          break
        case 'invalid':
          set({
            ...emptyProject(),
            hydrated: true,
            persistence: 'blocked',
            notice: { kind: 'invalid', errors: result.errors },
          })
          break
        case 'unavailable':
          set({
            ...emptyProject(),
            hydrated: true,
            persistence: 'ready',
            notice: { kind: 'unavailable', message: result.message },
          })
          break
      }
    },

    startNewProject: () =>
      set({ ...emptyProject(), persistence: 'ready', notice: null }),

    addTable: () => {
      const { schema, view } = get()
      const id = newId()
      const name = nextName(
        'table',
        schema.tables.map((table) => table.name)
      )
      set({
        schema: core.addTable(schema, { id, name }),
        view: {
          ...view,
          nodes: {
            ...view.nodes,
            [id]: nextNodePosition(schema.tables.length),
          },
        },
        selection: id,
      })
      return id
    },

    renameTable: (tableId, name) =>
      set({ schema: core.renameTable(get().schema, tableId, name) }),

    removeTable: (tableId) => {
      const { schema, view, selection } = get()
      const { [tableId]: _removed, ...nodes } = view.nodes
      set({
        schema: core.removeTable(schema, tableId),
        view: { ...view, nodes },
        selection: selection === tableId ? null : selection,
      })
    },

    addColumn: (tableId) => {
      const { schema } = get()
      const table = schema.tables.find((candidate) => candidate.id === tableId)
      if (!table) return null
      const id = newId()
      const column: Column = {
        id,
        name: nextName(
          'column',
          table.columns.map((existing) => existing.name)
        ),
        type: { kind: 'text' },
        nullable: true,
      }
      set({ schema: core.addColumn(schema, tableId, column) })
      return id
    },

    updateColumn: (tableId, columnId, patch) =>
      set({
        schema: core.updateColumn(get().schema, tableId, columnId, patch),
      }),

    removeColumn: (tableId, columnId) =>
      set({ schema: core.removeColumn(get().schema, tableId, columnId) }),

    setPrimaryKey: (tableId, columnIds) =>
      set({ schema: core.setPrimaryKey(get().schema, tableId, columnIds) }),

    connect: (from, to) => {
      const { schema } = get()
      const issue = core.checkRelationship(schema, from, to)
      if (issue) return issue
      set({
        schema: core.addRelationship(schema, { id: newId(), from, to }),
      })
      return null
    },

    removeRelationship: (relationshipId) =>
      set({
        schema: core.removeRelationship(get().schema, relationshipId),
      }),

    moveNode: (tableId, position) => {
      const { view } = get()
      set({
        view: { ...view, nodes: { ...view.nodes, [tableId]: position } },
      })
    },

    setViewport: (viewport) => set({ view: { ...get().view, viewport } }),

    select: (tableId) => set({ selection: tableId }),
  }))
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd apps/web && node --test src/tests/unit/lib/store/forge-store.test.ts`
Expected: PASS — 20 tests, 0 failures.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): add the Zustand store for schema, view and selection

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web — canvas conversion (store state to React Flow)

**Files:**
- Create: `apps/web/src/lib/canvas/to-flow.ts`
- Test: `apps/web/src/tests/unit/lib/canvas/to-flow.test.ts`

**Interfaces:**
- Consumes: `Schema`, `TableId`, `ColumnRef` from `@forge/core`; `ProjectView`, `nextNodePosition` from `lib/project-view.ts`; the types `Node`, `Edge` from `@xyflow/react` (type-only, erased at runtime).
- Produces (`lib/canvas/to-flow.ts`):
  - `TableNodeData = { tableId: TableId }`, `TableFlowNode = Node<TableNodeData, 'table'>`
  - `toFlowNodes(schema: Schema, view: ProjectView, selection: TableId | null): TableFlowNode[]` — one node per table, `type: 'table'`, `data` holds **only** the table id, position from `view.nodes` or `nextNodePosition(index)`, `selected` from the selection
  - `toFlowEdges(schema: Schema): Edge[]` — one edge per relationship, `id` is the relationship id, `sourceHandle`/`targetHandle` are the column ids
  - `ConnectionLike { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }`
  - `connectionToRefs(connection: ConnectionLike): { from: ColumnRef; to: ColumnRef } | null` — `null` when a handle id is missing

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/tests/unit/lib/canvas/to-flow.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import {
  connectionToRefs,
  toFlowEdges,
  toFlowNodes,
} from '../../../../lib/canvas/to-flow.ts'
import { createView, nextNodePosition } from '../../../../lib/project-view.ts'

const schema: Schema = {
  version: 1,
  tables: [
    {
      id: 'a',
      name: 'a',
      columns: [
        { id: 'a1', name: 'id', type: { kind: 'uuid' }, nullable: false },
      ],
      primaryKey: ['a1'],
    },
    {
      id: 'b',
      name: 'b',
      columns: [
        { id: 'b1', name: 'a_id', type: { kind: 'uuid' }, nullable: true },
      ],
      primaryKey: [],
    },
  ],
  relationships: [
    {
      id: 'r',
      from: { tableId: 'b', columnId: 'b1' },
      to: { tableId: 'a', columnId: 'a1' },
    },
  ],
}

describe('toFlowNodes', () => {
  it('creates one table node per table that carries only the table id', () => {
    const nodes = toFlowNodes(schema, createView(), null)
    assert.equal(nodes.length, 2)
    assert.equal(nodes[0]?.id, 'a')
    assert.equal(nodes[0]?.type, 'table')
    assert.deepEqual(nodes[0]?.data, { tableId: 'a' })
  })

  it('uses the saved position and falls back to the grid', () => {
    const view = { ...createView(), nodes: { a: { x: 7, y: 8 } } }
    const nodes = toFlowNodes(schema, view, null)
    assert.deepEqual(nodes[0]?.position, { x: 7, y: 8 })
    assert.deepEqual(nodes[1]?.position, nextNodePosition(1))
  })

  it('marks only the selected table as selected', () => {
    const nodes = toFlowNodes(schema, createView(), 'b')
    assert.deepEqual(
      nodes.map((node) => node.selected),
      [false, true]
    )
  })
})

describe('toFlowEdges', () => {
  it('creates one edge per relationship from column handle to column handle', () => {
    assert.deepEqual(toFlowEdges(schema), [
      {
        id: 'r',
        source: 'b',
        sourceHandle: 'b1',
        target: 'a',
        targetHandle: 'a1',
      },
    ])
  })

  it('returns no edges for a schema without relationships', () => {
    assert.deepEqual(toFlowEdges({ ...schema, relationships: [] }), [])
  })
})

describe('connectionToRefs', () => {
  it('turns a connection into from and to column references', () => {
    assert.deepEqual(
      connectionToRefs({
        source: 'b',
        sourceHandle: 'b1',
        target: 'a',
        targetHandle: 'a1',
      }),
      {
        from: { tableId: 'b', columnId: 'b1' },
        to: { tableId: 'a', columnId: 'a1' },
      }
    )
  })

  it('returns null when a handle is missing', () => {
    assert.equal(
      connectionToRefs({
        source: 'b',
        sourceHandle: null,
        target: 'a',
        targetHandle: 'a1',
      }),
      null
    )
    assert.equal(connectionToRefs({ source: 'b', target: 'a' }), null)
  })
})
```

- [ ] **Step 2: Run them and verify they fail**

Run: `cd apps/web && node --test src/tests/unit/lib/canvas/to-flow.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `lib/canvas/to-flow.ts`.

- [ ] **Step 3: Implement the conversion**

Create `apps/web/src/lib/canvas/to-flow.ts`:

```ts
import type { ColumnRef, Schema, TableId } from '@forge/core'
import type { Edge, Node } from '@xyflow/react'

import { nextNodePosition } from '../project-view.ts'
import type { ProjectView } from '../project-view.ts'

/** A table node references a table by id and holds no schema data. */
export type TableNodeData = { tableId: TableId }

export type TableFlowNode = Node<TableNodeData, 'table'>

export function toFlowNodes(
  schema: Schema,
  view: ProjectView,
  selection: TableId | null
): TableFlowNode[] {
  return schema.tables.map((table, index) => ({
    id: table.id,
    type: 'table',
    position: view.nodes[table.id] ?? nextNodePosition(index),
    data: { tableId: table.id },
    selected: table.id === selection,
  }))
}

/** One edge per relationship; the handle ids are the column ids. */
export function toFlowEdges(schema: Schema): Edge[] {
  return schema.relationships.map((relationship) => ({
    id: relationship.id,
    source: relationship.from.tableId,
    sourceHandle: relationship.from.columnId,
    target: relationship.to.tableId,
    targetHandle: relationship.to.columnId,
  }))
}

export interface ConnectionLike {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export function connectionToRefs(
  connection: ConnectionLike
): { from: ColumnRef; to: ColumnRef } | null {
  if (!connection.sourceHandle || !connection.targetHandle) return null
  return {
    from: { tableId: connection.source, columnId: connection.sourceHandle },
    to: { tableId: connection.target, columnId: connection.targetHandle },
  }
}
```

- [ ] **Step 4: Run them and verify they pass**

Run: `cd apps/web && node --test src/tests/unit/lib/canvas/to-flow.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): convert the store state into React Flow nodes and edges

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Web — editing UI (store hook, inspector, toolbar, DDL panel, startup notice)

These components hold no logic of their own, so by the testing ADR they are not rendered in tests; the only testable piece, the primary-key toggle, is a pure function. Verification here is typecheck, lint and the manual check in Task 12.

**Files:**
- Create: `apps/web/src/lib/primary-key.ts`
- Create: `apps/web/src/hooks/use-forge-store.ts`
- Create: `apps/web/src/components/inspector/inspector.tsx`
- Create: `apps/web/src/components/toolbar/toolbar.tsx`
- Create: `apps/web/src/components/ddl/ddl-panel.tsx`
- Create: `apps/web/src/components/startup-notice.tsx`
- Test: `apps/web/src/tests/unit/lib/primary-key.test.ts`

**Interfaces:**
- Consumes: Tasks 6 and 8 (`COLUMN_KINDS`, `defaultColumnType`, the `set*` helpers, `createForgeStore`, `ForgeState`), `generateDdl`, `postgres`, `Table`, `Column` from `@forge/core`.
- Produces:
  - `nextPrimaryKey(table: Table, columnId: string, checked: boolean): string[]` — the table's primary key after toggling one column, in column order
  - `forgeStore` (the app's single store instance, ids from `crypto.randomUUID()`) and `useForgeStore<T>(selector: (state: ForgeState) => T): T` (`hooks/use-forge-store.ts`)
  - Components: `Inspector()`, `Toolbar({ ddlOpen, onToggleDdl })`, `DdlPanel()`, `StartupNotice()`

- [ ] **Step 1: Write the failing test for the primary-key toggle**

Create `apps/web/src/tests/unit/lib/primary-key.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Table } from '@forge/core'

import { nextPrimaryKey } from '../../../lib/primary-key.ts'

const table: Table = {
  id: 't',
  name: 't',
  columns: [
    { id: 'a', name: 'a', type: { kind: 'text' }, nullable: true },
    { id: 'b', name: 'b', type: { kind: 'text' }, nullable: true },
    { id: 'c', name: 'c', type: { kind: 'text' }, nullable: true },
  ],
  primaryKey: ['c'],
}

describe('nextPrimaryKey', () => {
  it('adds a checked column and keeps the key in column order', () => {
    assert.deepEqual(nextPrimaryKey(table, 'a', true), ['a', 'c'])
  })

  it('removes an unchecked column', () => {
    assert.deepEqual(nextPrimaryKey(table, 'c', false), [])
  })

  it('leaves the key as it was when the state does not change', () => {
    assert.deepEqual(nextPrimaryKey(table, 'c', true), ['c'])
    assert.deepEqual(nextPrimaryKey(table, 'b', false), ['c'])
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `cd apps/web && node --test src/tests/unit/lib/primary-key.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `lib/primary-key.ts`.

- [ ] **Step 3: Implement the toggle and the store hook**

Create `apps/web/src/lib/primary-key.ts`:

```ts
import type { Table } from '@forge/core'

/** The primary key after (un)checking one column, in column order. */
export function nextPrimaryKey(
  table: Table,
  columnId: string,
  checked: boolean
): string[] {
  return table.columns
    .filter((column) =>
      column.id === columnId ? checked : table.primaryKey.includes(column.id)
    )
    .map((column) => column.id)
}
```

Create `apps/web/src/hooks/use-forge-store.ts`:

```ts
import { useStore } from 'zustand'

import { createForgeStore } from '../lib/store/forge-store.ts'
import type { ForgeState } from '../lib/store/forge-store.ts'

/** The app's only store. `randomUUID` needs HTTPS or localhost, which holds. */
export const forgeStore = createForgeStore({
  newId: () => crypto.randomUUID(),
})

export function useForgeStore<T>(selector: (state: ForgeState) => T): T {
  return useStore(forgeStore, selector)
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd apps/web && node --test src/tests/unit/lib/primary-key.test.ts`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5: Write the inspector**

Create `apps/web/src/components/inspector/inspector.tsx`:

```tsx
import type { Column, Table } from '@forge/core'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import {
  COLUMN_KINDS,
  defaultColumnType,
  setNumericPrecision,
  setNumericScale,
  setVarcharLength,
} from '../../lib/column-types.ts'
import type { ColumnKind } from '../../lib/column-types.ts'
import { nextPrimaryKey } from '../../lib/primary-key.ts'

function ColumnRow({ table, column }: { table: Table; column: Column }) {
  const { updateColumn, removeColumn, setPrimaryKey } = forgeStore.getState()
  const isPrimaryKey = table.primaryKey.includes(column.id)

  return (
    <li className='column-row'>
      <input
        aria-label='Column name'
        value={column.name}
        onChange={(event) =>
          updateColumn(table.id, column.id, { name: event.target.value })
        }
      />
      <select
        aria-label='Column type'
        value={column.type.kind}
        onChange={(event) =>
          updateColumn(table.id, column.id, {
            type: defaultColumnType(event.target.value as ColumnKind),
          })
        }
      >
        {COLUMN_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>
      {column.type.kind === 'varchar' && (
        <input
          aria-label='Length'
          type='number'
          min={1}
          value={column.type.length}
          onChange={(event) => {
            if (event.target.value === '') return
            updateColumn(table.id, column.id, {
              type: setVarcharLength(column.type, Number(event.target.value)),
            })
          }}
        />
      )}
      {column.type.kind === 'numeric' && (
        <>
          <input
            aria-label='Precision'
            type='number'
            min={1}
            value={column.type.precision}
            onChange={(event) => {
              if (event.target.value === '') return
              updateColumn(table.id, column.id, {
                type: setNumericPrecision(
                  column.type,
                  Number(event.target.value)
                ),
              })
            }}
          />
          <input
            aria-label='Scale'
            type='number'
            min={0}
            value={column.type.scale}
            onChange={(event) => {
              if (event.target.value === '') return
              updateColumn(table.id, column.id, {
                type: setNumericScale(column.type, Number(event.target.value)),
              })
            }}
          />
        </>
      )}
      <label>
        <input
          type='checkbox'
          checked={isPrimaryKey}
          onChange={(event) =>
            setPrimaryKey(
              table.id,
              nextPrimaryKey(table, column.id, event.target.checked)
            )
          }
        />
        PK
      </label>
      <label>
        <input
          type='checkbox'
          checked={!column.nullable || isPrimaryKey}
          disabled={isPrimaryKey}
          onChange={(event) =>
            updateColumn(table.id, column.id, {
              nullable: !event.target.checked,
            })
          }
        />
        NOT NULL
      </label>
      <button
        type='button'
        aria-label='Remove column'
        onClick={() => removeColumn(table.id, column.id)}
      >
        ×
      </button>
    </li>
  )
}

export function Inspector() {
  const table = useForgeStore((state) =>
    state.schema.tables.find((candidate) => candidate.id === state.selection)
  )
  const { renameTable, removeTable, addColumn } = forgeStore.getState()

  if (!table) {
    return (
      <aside className='inspector'>
        <p className='inspector__hint'>
          Select a table to edit it, or add a new one from the toolbar.
        </p>
      </aside>
    )
  }

  return (
    <aside className='inspector'>
      <label className='field'>
        Table name
        <input
          value={table.name}
          onChange={(event) => renameTable(table.id, event.target.value)}
        />
      </label>
      <h2 className='inspector__heading'>Columns</h2>
      <ul className='column-list'>
        {table.columns.map((column) => (
          <ColumnRow key={column.id} table={table} column={column} />
        ))}
      </ul>
      <div className='inspector__actions'>
        <button type='button' onClick={() => addColumn(table.id)}>
          Add column
        </button>
        <button
          type='button'
          className='danger'
          onClick={() => removeTable(table.id)}
        >
          Delete table
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 6: Write the toolbar, the DDL panel and the startup notice**

Create `apps/web/src/components/toolbar/toolbar.tsx`:

```tsx
import { forgeStore } from '../../hooks/use-forge-store.ts'

interface ToolbarProps {
  ddlOpen: boolean
  onToggleDdl: () => void
}

export function Toolbar({ ddlOpen, onToggleDdl }: ToolbarProps) {
  return (
    <header className='toolbar'>
      <h1 className='toolbar__title'>Forge</h1>
      <button type='button' onClick={() => forgeStore.getState().addTable()}>
        New table
      </button>
      <button type='button' aria-pressed={ddlOpen} onClick={onToggleDdl}>
        {ddlOpen ? 'Hide DDL' : 'Show DDL'}
      </button>
    </header>
  )
}
```

Create `apps/web/src/components/ddl/ddl-panel.tsx`:

```tsx
import { generateDdl, postgres } from '@forge/core'
import { useState } from 'react'

import { useForgeStore } from '../../hooks/use-forge-store.ts'

type CopyState = 'idle' | 'copied' | 'failed'

export function DdlPanel() {
  const schema = useForgeStore((state) => state.schema)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const result = generateDdl(schema, postgres)

  async function copy(sql: string) {
    try {
      await navigator.clipboard.writeText(sql)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    setTimeout(() => setCopyState('idle'), 1500)
  }

  if (!result.ok) {
    return (
      <section className='ddl-panel' aria-label='DDL'>
        <p>Fix these problems to generate the DDL:</p>
        <ul>
          {result.issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.tableId ?? ''}:${issue.columnId ?? ''}:${issue.relationshipId ?? ''}`}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className='ddl-panel' aria-label='DDL'>
      {result.sql === '' ? (
        <p>Add a table to generate the DDL.</p>
      ) : (
        <>
          <button type='button' onClick={() => copy(result.sql)}>
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy'}
          </button>
          <pre>
            <code>{result.sql}</code>
          </pre>
        </>
      )}
    </section>
  )
}
```

Create `apps/web/src/components/startup-notice.tsx`:

```tsx
import { forgeStore, useForgeStore } from '../hooks/use-forge-store.ts'

export function StartupNotice() {
  const notice = useForgeStore((state) => state.notice)
  if (!notice) return null

  if (notice.kind === 'unavailable') {
    return (
      <div role='alert' className='banner banner--warning'>
        Browser storage is unavailable ({notice.message}). Your changes will not
        be saved.
      </div>
    )
  }

  return (
    <div role='alert' className='banner banner--error'>
      <p>
        The saved project could not be read, so it was left untouched. Nothing
        will be saved until you start a new project.
      </p>
      <ul>
        {notice.errors.slice(0, 5).map((error) => (
          <li key={`${error.path}:${error.message}`}>
            {error.path ? `${error.path}: ` : ''}
            {error.message}
          </li>
        ))}
      </ul>
      <button
        type='button'
        onClick={() => forgeStore.getState().startNewProject()}
      >
        Start a new project
      </button>
    </div>
  )
}
```

- [ ] **Step 7: Typecheck, lint and commit**

```bash
pnpm lint:fix && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): add the inspector, toolbar, DDL panel and startup notice

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: typecheck passes for all new components; `pnpm lint` is clean (the inspector's `<label>` wrappers and `type='button'` attributes satisfy Biome's accessibility rules).

---

### Task 11: Web — canvas, persistence hooks, autosave and the editor page

Like Task 10, the code here is wiring with no logic of its own (ADR: not tested by rendering). The behavior it wires is covered by Tasks 7–9; Task 12 checks it by hand.

**Files:**
- Create: `apps/web/src/components/canvas/table-node.tsx`
- Create: `apps/web/src/components/canvas/canvas.tsx`
- Create: `apps/web/src/queries/project/use-load-project.ts`
- Create: `apps/web/src/queries/project/use-save-project.ts`
- Create: `apps/web/src/hooks/use-autosave.ts`
- Create: `apps/web/src/styles.css`
- Modify (replace contents): `apps/web/src/routes/index.tsx`
- Modify (replace contents): `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: Tasks 7–10 — `loadProject`, `saveProject`, `localStorageProject`, `forgeStore`, `useForgeStore`, `toFlowNodes`, `toFlowEdges`, `connectionToRefs`, `TableFlowNode`, `formatColumnType`, the components of Task 10, `createProject` and `checkRelationship` from `@forge/core`.
- Produces: `TableNode`, `Canvas`, `useLoadProject()` (TanStack `useQuery` that resolves to a `LoadResult` once), `useSaveProject()` (TanStack `useMutation` taking a `Project`), `useAutosave(): string | null` (the save error message, or `null`).

- [ ] **Step 1: Write the table node**

Create `apps/web/src/components/canvas/table-node.tsx`:

```tsx
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { useEffect } from 'react'

import { useForgeStore } from '../../hooks/use-forge-store.ts'
import type { TableFlowNode } from '../../lib/canvas/to-flow.ts'
import { formatColumnType } from '../../lib/column-types.ts'

export function TableNode({ id, data }: NodeProps<TableFlowNode>) {
  const table = useForgeStore((state) =>
    state.schema.tables.find((candidate) => candidate.id === data.tableId)
  )
  const updateNodeInternals = useUpdateNodeInternals()

  // React Flow measures handle positions once; adding, removing or reordering
  // columns changes them, so it has to be told (ADR-0002 of the web app).
  const columnKey = table?.columns.map((column) => column.id).join('|') ?? ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: columnKey is the trigger, not a value read inside
  useEffect(() => {
    updateNodeInternals(id)
  }, [columnKey, id, updateNodeInternals])

  if (!table) return null

  return (
    <div className='table-node'>
      <div className='table-node__title'>{table.name || '(unnamed)'}</div>
      <ul className='table-node__columns'>
        {table.columns.map((column) => (
          <li key={column.id} className='table-node__column'>
            <Handle type='target' position={Position.Left} id={column.id} />
            {table.primaryKey.includes(column.id) && (
              <span className='table-node__badge'>PK</span>
            )}
            <span className='table-node__name'>
              {column.name || '(unnamed)'}
            </span>
            <span className='table-node__type'>
              {formatColumnType(column.type)}
            </span>
            <Handle type='source' position={Position.Right} id={column.id} />
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Write the canvas**

Create `apps/web/src/components/canvas/canvas.tsx`:

```tsx
import { checkRelationship } from '@forge/core'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import type { Connection, Edge, EdgeChange, NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import {
  connectionToRefs,
  toFlowEdges,
  toFlowNodes,
} from '../../lib/canvas/to-flow.ts'
import type { TableFlowNode } from '../../lib/canvas/to-flow.ts'
import { TableNode } from './table-node.tsx'

const nodeTypes = { table: TableNode }

export function Canvas() {
  const schema = useForgeStore((state) => state.schema)
  const view = useForgeStore((state) => state.view)
  const selection = useForgeStore((state) => state.selection)

  const nodes = toFlowNodes(schema, view, selection)
  const edges = toFlowEdges(schema)

  // Only moves and edge removals are applied: tables are created and deleted
  // from the toolbar and the inspector, never by a keypress on the canvas.
  function onNodesChange(changes: NodeChange<TableFlowNode>[]) {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        forgeStore.getState().moveNode(change.id, change.position)
      }
    }
  }

  function onEdgesChange(changes: EdgeChange[]) {
    for (const change of changes) {
      if (change.type === 'remove') {
        forgeStore.getState().removeRelationship(change.id)
      }
    }
  }

  function isValidConnection(connection: Connection | Edge) {
    const refs = connectionToRefs(connection)
    if (!refs) return false
    return (
      checkRelationship(forgeStore.getState().schema, refs.from, refs.to) ===
      null
    )
  }

  function onConnect(connection: Connection) {
    const refs = connectionToRefs(connection)
    if (refs) forgeStore.getState().connect(refs.from, refs.to)
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onNodeClick={(_, node) => forgeStore.getState().select(node.id)}
      onPaneClick={() => forgeStore.getState().select(null)}
      onMoveEnd={(_, viewport) => forgeStore.getState().setViewport(viewport)}
      defaultViewport={view.viewport}
      colorMode='system'
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
```

- [ ] **Step 3: Write the persistence hooks and the autosave**

Create `apps/web/src/queries/project/use-load-project.ts`:

```ts
import { useQuery } from '@tanstack/react-query'

import { localStorageProject } from '../../lib/storage/default-storage.ts'
import { loadProject } from './load-project.ts'

/** Loads the stored project once; it never refetches on its own. */
export function useLoadProject() {
  return useQuery({
    queryKey: ['project'],
    queryFn: () => loadProject(localStorageProject),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
```

Create `apps/web/src/queries/project/use-save-project.ts`:

```ts
import type { Project } from '@forge/core'
import { useMutation } from '@tanstack/react-query'

import { localStorageProject } from '../../lib/storage/default-storage.ts'
import { saveProject } from './save-project.ts'

export function useSaveProject() {
  return useMutation({
    mutationFn: async (project: Project) => {
      const result = saveProject(localStorageProject, project)
      if (!result.ok) throw new Error(result.message)
    },
  })
}
```

Create `apps/web/src/hooks/use-autosave.ts`:

```ts
import { createProject } from '@forge/core'
import { useEffect } from 'react'

import { localStorageProject } from '../lib/storage/default-storage.ts'
import { saveProject } from '../queries/project/save-project.ts'
import { useSaveProject } from '../queries/project/use-save-project.ts'
import { forgeStore, useForgeStore } from './use-forge-store.ts'

const AUTOSAVE_DELAY_MS = 500

/**
 * Saves the project shortly after it stops changing. Nothing is saved while
 * persistence is blocked (the stored project was unreadable and is left as is).
 * Returns the message of the last save error, or null.
 */
export function useAutosave(): string | null {
  const schema = useForgeStore((state) => state.schema)
  const view = useForgeStore((state) => state.view)
  const persistence = useForgeStore((state) => state.persistence)
  const { mutate, isError, error } = useSaveProject()

  useEffect(() => {
    if (persistence !== 'ready') return
    const timer = setTimeout(
      () => mutate(createProject(schema, view)),
      AUTOSAVE_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [schema, view, persistence, mutate])

  // A change made in the last half second would otherwise be lost on close.
  useEffect(() => {
    function flush() {
      const state = forgeStore.getState()
      if (state.persistence !== 'ready') return
      saveProject(
        localStorageProject,
        createProject(state.schema, state.view)
      )
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  return isError ? error.message : null
}
```

- [ ] **Step 4: Write the styles, the page and the entry point**

Create `apps/web/src/styles.css`:

```css
:root {
  color-scheme: light dark;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --border: #d5d9e0;
  --text: #1c2330;
  --muted: #667085;
  --accent: #2f6fed;
  --error-bg: #fdecec;
  --error-text: #8a1c1c;
  --warn-bg: #fff6df;
  --warn-text: #7a5200;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12151b;
    --panel: #1b2029;
    --border: #2d3441;
    --text: #e6e9ef;
    --muted: #9aa4b5;
    --accent: #6c9bff;
    --error-bg: #3a1b1b;
    --error-text: #ffb4b4;
    --warn-bg: #3a2e12;
    --warn-text: #ffd98a;
  }
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg);
  color: var(--text);
  font: 14px/1.4 system-ui, sans-serif;
}

button,
input,
select {
  font: inherit;
}

button {
  cursor: pointer;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.loading {
  padding: 24px;
  color: var(--muted);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.toolbar__title {
  margin: 0 12px 0 0;
  font-size: 16px;
}

.banner {
  padding: 8px 12px;
  font-size: 13px;
}

.banner p,
.banner ul {
  margin: 0 0 6px;
}

.banner--error {
  background: var(--error-bg);
  color: var(--error-text);
}

.banner--warning {
  background: var(--warn-bg);
  color: var(--warn-text);
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  flex: 1;
  min-height: 0;
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.canvas {
  flex: 1;
  min-height: 0;
}

.ddl-panel {
  height: 260px;
  overflow: auto;
  padding: 8px 12px;
  background: var(--panel);
  border-top: 1px solid var(--border);
}

.ddl-panel pre {
  margin: 8px 0 0;
  font-size: 12px;
}

.inspector {
  overflow: auto;
  padding: 12px;
  background: var(--panel);
  border-left: 1px solid var(--border);
}

.inspector__hint {
  color: var(--muted);
}

.inspector__heading {
  margin: 16px 0 8px;
  font-size: 13px;
  text-transform: uppercase;
  color: var(--muted);
}

.inspector__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.column-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.column-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.column-row input[type='number'] {
  width: 72px;
}

.danger {
  color: var(--error-text);
}

.table-node {
  min-width: 220px;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}

.table-node__title {
  padding: 6px 10px;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
}

.table-node__columns {
  margin: 0;
  padding: 0;
  list-style: none;
}

.table-node__column {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
}

.table-node__badge {
  padding: 0 4px;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 3px;
}

.table-node__name {
  flex: 1;
}

.table-node__type {
  color: var(--muted);
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
```

Replace the contents of `apps/web/src/routes/index.tsx` with:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Canvas } from '../components/canvas/canvas.tsx'
import { DdlPanel } from '../components/ddl/ddl-panel.tsx'
import { Inspector } from '../components/inspector/inspector.tsx'
import { StartupNotice } from '../components/startup-notice.tsx'
import { Toolbar } from '../components/toolbar/toolbar.tsx'
import { useAutosave } from '../hooks/use-autosave.ts'
import { forgeStore, useForgeStore } from '../hooks/use-forge-store.ts'
import { useLoadProject } from '../queries/project/use-load-project.ts'

export const Route = createFileRoute('/')({
  component: EditorPage,
})

function EditorPage() {
  const load = useLoadProject()
  const hydrated = useForgeStore((state) => state.hydrated)

  useEffect(() => {
    if (load.data && !forgeStore.getState().hydrated) {
      forgeStore.getState().hydrate(load.data)
    }
  }, [load.data])

  if (!hydrated) return <p className='loading'>Loading…</p>
  return <Editor />
}

function Editor() {
  const [ddlOpen, setDdlOpen] = useState(false)
  const saveError = useAutosave()

  return (
    <div className='app'>
      <Toolbar ddlOpen={ddlOpen} onToggleDdl={() => setDdlOpen(!ddlOpen)} />
      <StartupNotice />
      {saveError && (
        <div role='alert' className='banner banner--error'>
          Could not save the project: {saveError}
        </div>
      )}
      <div className='workspace'>
        <main className='main'>
          <div className='canvas'>
            <Canvas />
          </div>
          {ddlOpen && <DdlPanel />}
        </main>
        <Inspector />
      </div>
    </div>
  )
}
```

Replace the contents of `apps/web/src/main.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { routeTree } from './routeTree.gen.ts'
import './styles.css'

const queryClient = new QueryClient()
const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
```

- [ ] **Step 5: Typecheck, lint, test and build**

```bash
pnpm lint:fix && pnpm typecheck && pnpm test && pnpm --filter @forge/web build
```
Expected: lint clean, typecheck clean, tests pass (83 core + 65 web), `vite build` prints `✓ built`. If Biome reports `useExhaustiveDependencies` on `table-node.tsx` anyway, keep the `biome-ignore` comment exactly as written: `columnKey` is intentionally the only trigger.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): wire the canvas, autosave and the editor page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Glossaries, ADRs, and final verification

**Files:**
- Create: `packages/core/GLOSSARY.md`
- Create: `apps/web/GLOSSARY.md`
- Create: `packages/core/docs/adr/0002-immutable-schema-and-pure-operations.md`
- Create: `packages/core/docs/adr/0003-logical-column-types-mapped-per-dialect.md`
- Create: `packages/core/docs/adr/0004-project-envelope-with-opaque-view.md`
- Create: `apps/web/docs/adr/0004-tanstack-query-for-persistence.md`
- Modify: `GLOSSARY-MAP.md` (both "Not created yet" lines)

**Interfaces:**
- Consumes: the finished slice.
- Produces: documentation only.

- [ ] **Step 1: Write the core glossary**

Create `packages/core/GLOSSARY.md`:

```markdown
# Glossary: `@forge/core`

The vocabulary of the domain model. Nothing here knows about the canvas.

**Schema**: the whole database design of one project: its tables and the relationships between them. Plain, JSON-serializable data, never mutated; every edit returns a new Schema.

**Table**: a database table: a name, an ordered list of columns, and a primary key. It is not a box on the canvas: that is a *table node*, owned by `apps/web`, which only references a Table by id.

**Column**: one field of a Table: a name, a column type, and whether it is nullable.

**Column type**: the *logical* type of a column (`integer`, `bigint`, `text`, `boolean`, `uuid`, `timestamp`, `date`, `json`, `varchar(n)`, `numeric(p,s)`). A dialect maps it to a real database type. `timestamp` means an instant in time.

**Primary key**: the list of columns that identify a row. May be composite. Its columns are always `NOT NULL` in the generated DDL.

**Relationship**: "this column references that column": a foreign key. It has a `from` column (the referencing one) and a `to` column (the referenced one). In this slice a Relationship involves exactly one column on each side, `to` must be the sole primary-key column of its table, and a column is the source of at most one Relationship. Avoid "foreign key" and "link" in code and UI text for the model concept.

**Issue**: one reason a Schema is not valid yet, with a code, a message and the ids it concerns. `validate` returns a list of them; an empty list means valid. A draft with Issues can still be saved.

**Dialect**: how one database writes SQL: how a column type is spelled, how an identifier is quoted, and how long an identifier may be. Only PostgreSQL exists.

**DDL** (Data Definition Language): the part of SQL that defines structure (`CREATE TABLE`, `ALTER TABLE`), as opposed to the part that handles data (`SELECT`, `INSERT`). "Generating DDL" turns a Schema into a script that creates it.

**Project**: the saved document: a format version, a Schema, and an opaque `view`. The core owns the envelope, its versioning and the validation of the Schema; it never reads the `view`.

**View**: the opaque slot of a Project that the web fills with node positions and the viewport. To the core it is just JSON to carry along.
```

- [ ] **Step 2: Write the web glossary**

Create `apps/web/GLOSSARY.md`:

```markdown
# Glossary: `apps/web`

The vocabulary of the canvas and the UI. The domain terms (Schema, Table, Column, Relationship) are defined in `packages/core/GLOSSARY.md` and used here as they are.

**Table node**: the box on the canvas that shows one Table. It references the Table by id and holds no schema data; its name, columns and types are read from the store. Avoid "table" for the box.

**Node**: anything positioned on the canvas. Today every Node is a table node.

**Viewport**: the pan and zoom of the canvas (`x`, `y`, `zoom`), saved with the project.

**Selection**: the Table currently chosen, shown in the Inspector; at most one, or none.

**Inspector**: the side panel that edits the selected Table: its name and its columns. The table node itself is read-only.

**Toolbar**: the strip with the project-level actions (new table, show or hide the DDL).

**DDL panel**: the panel that shows the PostgreSQL DDL generated from the Schema, or the list of Issues that prevent it.

**View**: what the web stores in the opaque `view` of a saved Project: node positions and the Viewport. It is cosmetic: a malformed one is replaced by defaults.

**Persistence mode**: `ready` (changes are autosaved) or `blocked` (the stored project could not be read, so nothing is saved until the user starts a new project).
```

- [ ] **Step 3: Write the core ADRs**

Create `packages/core/docs/adr/0002-immutable-schema-and-pure-operations.md`:

```markdown
# The schema is immutable data edited by pure functions

`Schema` is a plain, JSON-serializable object, and every edit (`addTable`, `updateColumn`, `setPrimaryKey`, ...) is a pure function that returns a new `Schema`, sharing every part that did not change. Validation is a separate pure function, `validate`, that returns a list of issues instead of throwing.

The alternatives were classes with mutable methods, and commands with `apply`/`undo`. Mutable classes fight the web's store, which needs immutable updates to keep unchanged nodes referentially stable (ADR-0003 of the web app), and they need a separate step to serialize. Commands give undo/redo, but nothing in the first slice asks for it; history can be layered on later by keeping earlier snapshots, since a snapshot is just a `Schema`.

## Consequences

**Operations never throw and never mutate.** Called with an id that no longer exists (a UI acting on something just deleted), an operation returns the same `Schema` object it received.

**Invalid is a state, not an exception.** A Schema with empty names or incompatible types can be built, saved and reloaded; `validate` reports it and the DDL generator refuses it. The user can leave a draft half-finished.

**IDs come from the caller.** The core does not generate them, because that would need `crypto` or a counter, which breaks the platform-free rule of ADR-0001 or makes tests depend on hidden state.
```

Create `packages/core/docs/adr/0003-logical-column-types-mapped-per-dialect.md`:

```markdown
# Columns hold a logical type; the dialect maps it to a database type

A column's type is a logical one from a curated set (`integer`, `bigint`, `text`, `boolean`, `uuid`, `timestamp`, `date`, `json`, `varchar(n)`, `numeric(p,s)`), and a `Dialect` translates it to the database's own type. The PostgreSQL dialect maps `timestamp` to `timestamptz` and `json` to `jsonb`; the rest map one to one.

The alternatives were storing a PostgreSQL type directly, and storing free text. Either would tie every saved project to PostgreSQL, so adding a second dialect would mean migrating saved data. With a logical type, a new dialect is one new mapping.

## Consequences

**The set is deliberately small.** A database type that is not in the set cannot be used until the set grows; that is a feature of the slice, not a gap to patch with free text.

**`timestamp` means an instant.** It becomes `timestamptz`, the safe PostgreSQL choice; a future dialect decides its own spelling.

**Foreign keys compare kinds, not parameters.** Two `varchar` columns of different lengths are compatible; `integer` and `bigint` are not.

**The type limits are the PostgreSQL ones** (`varchar` up to 10485760, `numeric` precision up to 1000), exported from the core so the parser and the editing UI share them.
```

Create `packages/core/docs/adr/0004-project-envelope-with-opaque-view.md`:

```markdown
# The saved project is an envelope with an opaque `view`

A saved project is `{ formatVersion, schema, view }`. The core owns the envelope, its version number and the validation of `schema` (`parseProject`); `view` is JSON that the core carries without reading. The web puts node positions and the viewport there.

Positions and viewport belong to the canvas, whose vocabulary (node, viewport, selection) is the web's, not the core's. Putting them in `Schema` would leak the canvas into the model. Putting the whole format in the web would move versioning and validation of the model out of the one place that can test them. The opaque slot keeps both boundaries.

## Consequences

**A project with Issues is still a valid file.** `parseProject` rejects only a document it cannot interpret: wrong shape, an unknown `formatVersion`, duplicate ids, or a reference to something that does not exist (a relationship pointing at a deleted table). Empty names and type mismatches are the user's draft, reported by `validate`.

**A newer file is refused, not guessed at.** A `formatVersion` this app does not know is an error with a clear message; the stored data is never rewritten on a failed load.

**The `view` is cosmetic.** The web validates it on its own and replaces a malformed one with defaults instead of failing the load.
```

- [ ] **Step 4: Write the web ADR and update the glossary map**

Create `apps/web/docs/adr/0004-tanstack-query-for-persistence.md`:

```markdown
# TanStack Query wraps the persistence functions

Loading and saving the project go through TanStack Query hooks in `queries/project/` (`useLoadProject`, `useSaveProject`), as the folder standard prescribes for every call to the persistence layer. The hooks are thin wrappers around plain functions, `loadProject(storage)` and `saveProject(storage, project)`, which hold the actual logic.

`localStorage` is synchronous, so TanStack Query adds nothing today. It is adopted now so that moving to `apps/api` later means writing a new storage adapter and nothing else: the components, the hooks and their call sites stay as they are, which is the intent of ADR-0003 (persistence goes through `queries/project/`). Plain hooks would work today and need rewriting when the API arrives.

## Consequences

**The logic lives outside the hooks.** `loadProject` and `saveProject` take a storage and return a result (`LoadResult`, `SaveResult`); they never throw. The tests exercise them directly under Node, with no rendering, which the testing ADR requires.

**The hooks are not tested.** They hold no logic: the query function, the mutation function and their options.

**Autosave is a component concern, not a query one.** `useAutosave` decides when to call the mutation (500 ms after the last change, and on `pagehide`), and does nothing while persistence is blocked.
```

Edit `GLOSSARY-MAP.md`: replace both occurrences of

```
- Not created yet. `/domain-modeling` writes them when terms actually get resolved.
```

with

```
- Created with slice 1; extend them as terms get resolved.
```

- [ ] **Step 5: Run the full verification**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @forge/web build
```
Expected: every command succeeds; `pnpm test` reports the core suite (83 tests) and the web suite (65 tests) with 0 failures; the build prints `✓ built`.

- [ ] **Step 6: Check the acceptance criteria by hand**

Start the app (`pnpm dev`, with Node 24) and open the printed local URL. Work through the six criteria of the spec; every line must hold:

1. **Edit.** Click "New table" twice; select the first; rename it `users`; add a column and set it to `uuid`; tick `PK`; add a column of every type from the dropdown (`varchar` and `numeric` show their number fields); tick `PK` on two columns of the second table; untick `NOT NULL` on a non-PK column.
2. **Relationships.** Drag from a `uuid` column's right handle of the second table to the left handle of `users.id`: an edge appears. Drag a column of a different type to `users.id`: no edge is created. Drag a second edge from the same source column: refused. Select a table that has the relationship: the inspector lists it under Relationships, and its remove button deletes it. Backspace on the canvas deletes nothing.
3. **DDL.** Click "Show DDL": the script shows `CREATE TABLE`, `PRIMARY KEY` and `ALTER TABLE ... FOREIGN KEY`. Rename the second table to `users`: the panel replaces the SQL with the duplicate-name problem. Rename it back; click "Copy" and paste somewhere: the script matches.
4. **Reload.** Move a table, pan and zoom the canvas, wait one second, reload the page: the tables, columns, relationships, positions and viewport are all back.
5. **Corrupt storage.** In the browser console run `localStorage.setItem('forge:project', '{"hello":"world"}')` and reload: a red banner explains the project could not be read, and the canvas is empty. Add a table, reload again: the banner is still there and `localStorage.getItem('forge:project')` still returns `{"hello":"world"}`. Click "Start a new project": the banner goes away and the next change is saved.
6. **Checks.** Step 5's commands already passed.

Any line that does not hold is a defect: fix it with a failing test first when the cause is in `lib/`, `queries/` or the core, and report it when it is in the components.

- [ ] **Step 7: Commit**

```bash
git add packages/core/GLOSSARY.md apps/web/GLOSSARY.md packages/core/docs/adr apps/web/docs/adr GLOSSARY-MAP.md
git commit -m "docs: add the core and web glossaries and the slice 1 ADRs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| Core model (types, operations) | 1 |
| Validation rules and `checkRelationship` | 2 |
| Dialect interface and PostgreSQL mapping | 3 |
| DDL generator (format, quoting, constraint names) | 4 |
| Project document and `parseProject` | 5 |
| Web state (store slices, actions, id generation) | 8 |
| Canvas (node and edge conversion, `isValidConnection`, handles, `useUpdateNodeInternals`) | 9, 11 |
| Screens (toolbar, inspector, DDL panel) | 10 |
| Persistence (adapter, key, load/save functions, TanStack Query hooks, autosave, blocked mode) | 6, 7, 8, 11 |
| Testing section | tests inside Tasks 1–9; components deliberately untested |
| Acceptance criteria 1–6 | Task 12, Step 6 |
| "To record after this spec" (glossaries, 4 ADRs) | Task 12 |

Deviations from the spec, all additive and listed where they occur: `Dialect.maxIdentifierBytes` (Task 3); numeric suffix on colliding constraint names and primary-key columns forced to `NOT NULL` in the DDL (Task 4); `MAX_VARCHAR_LENGTH` and `MAX_NUMERIC_PRECISION` exported from the core (Tasks 1, 5, 6); a `pagehide` flush in the autosave (Task 11).

**Placeholder scan.** No "to be decided" markers, no "implement later", no "similar to Task N". Every code step contains the code it describes.

**Type consistency.** Names are used identically across tasks: `Schema`, `Table`, `Column`, `ColumnRef`, `Relationship`, `Issue`, `IssueCode`, `Dialect`, `GenerateResult`, `Project`, `ParseError`, `ParseResult` (core); `LoadResult`, `SaveResult`, `ProjectStorage`, `StorageLike`, `ProjectView`, `NodePosition`, `Viewport`, `ForgeState`, `TableFlowNode`, `ConnectionLike` (web). Operations and store actions share their verbs (`addTable`, `updateColumn`, `setPrimaryKey`, ...); the store imports the core as `core.*` so the same name never refers to two things in one file.

**Validation already done on this plan.** Every file in the plan was extracted verbatim into a clean copy of the repository, with the dependencies installed for real, and run there: `pnpm lint:fix` leaves `pnpm lint` clean (the plan's code only needed Biome's formatting), `pnpm typecheck` passes in both packages, the core suite passes (83 tests) and so does the web suite (65 tests), and `pnpm --filter @forge/web build` succeeds. The acceptance criteria were then exercised in a browser against the dev server: creating and editing tables, connecting columns by dragging (a second relationship from the same column and a type mismatch are refused), the DDL panel with and without issues, edge removal by keyboard without deleting tables, persistence across a reload, and an unreadable stored project left untouched across edits and reloads until "Start a new project". The one thing seen in the browser that is not part of this slice is a 404 for `/favicon.ico`.
