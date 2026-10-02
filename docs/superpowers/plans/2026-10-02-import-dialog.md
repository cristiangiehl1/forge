# SQL import dialog (sub-project 3 of SQL import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A toolbar button **Import SQL** opens a dialog where the user pastes a script or loads a `.sql` file, sees a live preview (counts, warnings with their line, errors), chooses **Replace** or **Add** when the project already has tables, and imports; the new tables are laid out by their relationships.

**Architecture:** Pure helpers in `apps/web/src/lib/import/` (merge with renaming, placement of added tables, summary, limits) are unit-tested and know nothing about React; one new store action `importSchema(imported, mode)` applies the result; a native `<dialog>` component runs `importSql` from `@forge/core` when the text changes and shows the preview. The parser itself is already in the core (`importSql`).

**Tech Stack:** React 19 with the React Compiler (no `useMemo`/`useCallback`/`memo`), Zustand vanilla store, `node:test` with type stripping, Playwright, Biome, `@forge/core`.

**Spec:** `docs/superpowers/specs/2026-10-02-sql-import-design.md` (section 3, "Import dialog"). Built on `docs/superpowers/plans/2026-10-02-model-additions.md` and `docs/superpowers/plans/2026-10-02-sql-parser.md`, both already on `main`.

## Global Constraints

- Run Node through mise: prefix every command with `export PATH="$(mise where node)/bin:$PATH"`. Use absolute paths and run from `/home/cristian.giehl@koch.intranet/orca/projects/forge`. Without the mise PATH every `node --test` fails.
- Tests live in `apps/web/src/tests/unit/**` and `apps/e2e/tests/*.spec.ts`, never colocated. Web unit command: `pnpm --filter @forge/web test`. e2e: `cd apps/e2e && pnpm exec playwright test --workers=3` (the machine is often loaded; the default worker count has produced load-induced failures that pass in isolation).
- Style: `pnpm exec biome check --write apps packages` (single quotes, no semicolons, 2 spaces, width 80). Never put a comment inside `biome.json`.
- React Compiler is on: no `useMemo`, `useCallback` or `memo`. A component that must compute something on a change does it in the event handler and keeps the result in state.
- Node geometry is fixed (width 220, title 31, rows 26, border 1): nothing here may change a node's size.
- Work on a branch (`feat/import-dialog`), not `main`. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.
- Ids come from `crypto.randomUUID()`; imported ids are therefore unique against the project's, and merging does not remap ids.
- The preview shows what `importSql` returned; the same `schema` object that was previewed is what gets imported (no second parse).

## Rulings made while planning

- **Add is the default** when the project has tables; Replace needs a second click (`ConfirmButton`), like "Load example". With an empty project there is no choice to show, and the import is a plain replace.
- **An import into a project with no tables and no types is a replace in the store** (so it also clears a "stored project could not be read" notice and sets persistence back to `ready`, as Load example does).
- **Renaming covers three namespaces:** table names, index names (across all tables) and type names; each is made unique with `_2`, `_3`… against the current project and the names already given in this import. The dialog does not list renames: the new names are visible in the diagram.
- **Add does not reset the canvas** (no `projectEpoch` bump, so the viewport and the user's positions stay) but asks it to fit (`fitRequest`), and positions only the new tables, in a block to the right of the existing ones.
- **Limits:** a file over 2 MB is refused with a message; pasted text has no limit but the same 2 MB applies to the text area for consistency. At most 100 warnings are listed, with "…and N more".
- **No drag-and-drop** of files into the dialog in this version (a file picker and paste only).

## Review Focus

Inputs and conditions no single task's happy path covers (each gets a test in the task that owns the code):

1. Adding a script whose table, index and type names all collide with existing ones keeps every foreign key working (relationships point at ids, not names) and renames consistently (Task 1).
2. Adding to a project whose tables have no saved positions (grid fallback) places the new block to the right of where those tables are drawn, not on top of them (Task 1).
3. Replace clears selection, hover, the "could not be read" notice and sets persistence to `ready`; Add leaves persistence and the viewport alone (Task 2).
4. Importing a script with errors is impossible (the Import button is disabled), with nothing to import is impossible, and a large preview (hundreds of warnings) stays readable (Task 3, Task 4).
5. A file over 2 MB is refused without freezing the page; a non-SQL file (binary) does not crash the parser (Task 3, Task 4).
6. Escape and Cancel close the dialog without changing the project; the dialog keeps the pasted text until closed (Task 4).
7. After an import the autosave persists the project (reload shows it) (Task 4).

---

### Task 1: Pure import helpers

**Files:**
- Create: `apps/web/src/lib/import/merge-schema.ts`, `apps/web/src/lib/import/place-added.ts`, `apps/web/src/lib/import/summarize.ts`, `apps/web/src/lib/import/limits.ts`
- Test: `apps/web/src/tests/unit/lib/import/merge-schema.test.ts`, `place-added.test.ts`, `summarize.test.ts`, `limits.test.ts` (same folder)

**Interfaces:**
- Consumes: `Schema`, `Table`, `TableId`, `UserType`, `ImportResult` from `@forge/core`; `layoutTables` (`lib/layout/layout-tables.ts`, option `origin`); `resolvePositions` (`lib/canvas/to-flow.ts`); `nodeRect`, `Point` (`lib/geometry.ts`); `ProjectView` (`lib/project-view.ts`).
- Produces:
  - `merge-schema.ts`: `freeName(name: string, taken: Set<string>): string` (adds the result to `taken`); `interface Renamed { kind: 'table' | 'index' | 'type'; from: string; to: string }`; `mergeImported(current: Schema, imported: Schema): { schema: Schema; addedTableIds: TableId[]; renamed: Renamed[] }`
  - `place-added.ts`: `placeAdded(before: Schema, view: ProjectView, after: Schema, addedTableIds: TableId[]): Record<TableId, Point>`
  - `summarize.ts`: `interface ImportSummary { tables: number; columns: number; relationships: number; indexes: number; types: number }`, `summarize(schema: Schema): ImportSummary`, `describeSummary(summary: ImportSummary): string` (for example `7 tables, 28 columns, 8 relationships, 3 indexes, 1 type`; zero counts are left out; `nothing` when all are zero), `isEmptyImport(summary): boolean` (no tables and no types), `limitMessages<T>(list: T[], max: number): { shown: T[]; hidden: number }`
  - `limits.ts`: `MAX_SQL_BYTES = 2 * 1024 * 1024`, `tooBig(bytes: number): boolean`, `describeLimit(): string` (`2 MB`)

- [ ] **Step 1: Write the failing tests**

`merge-schema.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema, Table } from '@forge/core'

import { freeName, mergeImported } from '../../../../lib/import/merge-schema.ts'

const table = (id: string, name: string, extra: Partial<Table> = {}): Table => ({
  id,
  name,
  columns: [{ id: `${id}-c`, name: 'id', type: { kind: 'integer' }, nullable: false }],
  primaryKey: [`${id}-c`],
  ...extra,
})
const index = (id: string, name: string, column: string) => ({
  id,
  name,
  columns: [column],
  unique: false,
  method: 'btree' as const,
})
const schemaOf = (tables: Table[], extra: Partial<Schema> = {}): Schema => ({
  version: 1,
  tables,
  relationships: [],
  ...extra,
})

describe('freeName', () => {
  it('keeps a free name, and numbers a taken one from 2, remembering each result', () => {
    const taken = new Set(['users'])
    assert.equal(freeName('orders', taken), 'orders')
    assert.equal(freeName('users', taken), 'users_2')
    assert.equal(freeName('users', taken), 'users_3')
    assert.deepEqual([...taken].sort(), ['orders', 'users', 'users_2', 'users_3'])
  })

  it('skips a numbered name that is also taken', () => {
    assert.equal(freeName('a', new Set(['a', 'a_2'])), 'a_3')
  })
})

describe('mergeImported', () => {
  it('appends the imported tables, relationships and types after the current ones', () => {
    const current = schemaOf([table('t1', 'users')])
    const imported = schemaOf([table('t2', 'orders')], {
      relationships: [
        { id: 'r', from: { tableId: 't2', columnId: 't2-c' }, to: { tableId: 't2', columnId: 't2-c' } },
      ],
      types: [{ kind: 'enum', id: 'e', name: 'status', values: ['a'] }],
    })
    const merged = mergeImported(current, imported)
    assert.deepEqual(merged.schema.tables.map((t) => t.name), ['users', 'orders'])
    assert.deepEqual(merged.addedTableIds, ['t2'])
    assert.equal(merged.schema.relationships.length, 1)
    assert.deepEqual(merged.schema.types?.map((t) => t.name), ['status'])
    assert.deepEqual(merged.renamed, [])
  })

  it('renames a table, an index and a type that collide, and keeps every id and every relationship', () => {
    const current = schemaOf(
      [table('t1', 'users', { indexes: [index('i1', 'idx_users', 't1-c')] })],
      { types: [{ kind: 'enum', id: 'e1', name: 'status', values: ['a'] }] }
    )
    const imported = schemaOf(
      [
        table('t2', 'users', { indexes: [index('i2', 'idx_users', 't2-c')] }),
        table('t3', 'orders'),
      ],
      {
        relationships: [
          { id: 'r', from: { tableId: 't3', columnId: 't3-c' }, to: { tableId: 't2', columnId: 't2-c' } },
        ],
        types: [{ kind: 'enum', id: 'e2', name: 'status', values: ['b'] }],
      }
    )
    const merged = mergeImported(current, imported)
    assert.deepEqual(merged.schema.tables.map((t) => [t.id, t.name]), [
      ['t1', 'users'],
      ['t2', 'users_2'],
      ['t3', 'orders'],
    ])
    assert.deepEqual(merged.schema.tables[1]?.indexes?.map((i) => [i.id, i.name]), [['i2', 'idx_users_2']])
    assert.deepEqual(merged.schema.types?.map((t) => [t.id, t.name]), [
      ['e1', 'status'],
      ['e2', 'status_2'],
    ])
    assert.deepEqual(merged.schema.relationships[0]?.to, { tableId: 't2', columnId: 't2-c' })
    assert.deepEqual(merged.renamed, [
      { kind: 'table', from: 'users', to: 'users_2' },
      { kind: 'index', from: 'idx_users', to: 'idx_users_2' },
      { kind: 'type', from: 'status', to: 'status_2' },
    ])
  })

  it('does not change the schemas it was given', () => {
    const current = schemaOf([table('t1', 'users')])
    const imported = schemaOf([table('t2', 'users')])
    const before = JSON.stringify([current, imported])
    mergeImported(current, imported)
    assert.equal(JSON.stringify([current, imported]), before)
  })

  it('adds no types key when neither side has types, and works on an empty project', () => {
    const merged = mergeImported(schemaOf([]), schemaOf([table('t', 'a')]))
    assert.equal('types' in merged.schema, false)
    assert.equal(merged.schema.tables.length, 1)
  })
})
```

`place-added.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema, Table } from '@forge/core'

import { NODE_WIDTH, nodeRect } from '../../../../lib/geometry.ts'
import { placeAdded } from '../../../../lib/import/place-added.ts'
import { createView } from '../../../../lib/project-view.ts'

const table = (id: string, rows = 2): Table => ({
  id,
  name: id,
  columns: Array.from({ length: rows }, (_, i) => ({
    id: `${id}-${i}`,
    name: `c${i}`,
    type: { kind: 'integer' as const },
    nullable: true,
  })),
  primaryKey: [],
})
const schemaOf = (tables: Table[], relationships: Schema['relationships'] = []): Schema => ({
  version: 1,
  tables,
  relationships,
})

describe('placeAdded', () => {
  it('starts at the default origin on an empty project', () => {
    const after = schemaOf([table('n1')])
    const positions = placeAdded(schemaOf([]), createView(), after, ['n1'])
    assert.deepEqual(positions, { n1: { x: 40, y: 40 } })
  })

  it('puts the added tables to the right of the existing ones, none overlapping', () => {
    const before = schemaOf([table('a'), table('b')])
    const view = { ...createView(), nodes: { a: { x: 40, y: 40 }, b: { x: 600, y: 300 } } }
    const after = schemaOf([...before.tables, table('n1'), table('n2')])
    const positions = placeAdded(before, view, after, ['n1', 'n2'])
    const rightEdge = 600 + NODE_WIDTH
    for (const id of ['n1', 'n2']) {
      assert.ok((positions[id]?.x ?? 0) >= rightEdge + 100, `${id} at ${positions[id]?.x}`)
    }
    const boxes = Object.entries(positions).map(([id, p]) => nodeRect(p, 2))
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
        assert.ok(apart)
      }
    }
  })

  it('uses where a table is drawn when it has no saved position', () => {
    const before = schemaOf([table('a'), table('b'), table('c'), table('d')])
    const after = schemaOf([...before.tables, table('n')])
    const positions = placeAdded(before, createView(), after, ['n'])
    // the grid puts the 4th table at x = 40, the 3rd column at 40 + 2 * 320
    assert.ok((positions.n?.x ?? 0) >= 40 + 2 * 320 + NODE_WIDTH + 100)
  })

  it('lays the added tables out by their relationships, parents to the left', () => {
    const before = schemaOf([table('a')])
    const after = schemaOf(
      [table('a'), table('parent'), table('child')],
      [{ id: 'r', from: { tableId: 'child', columnId: 'child-0' }, to: { tableId: 'parent', columnId: 'parent-0' } }]
    )
    const positions = placeAdded(before, createView(), after, ['parent', 'child'])
    assert.ok((positions.parent?.x ?? 0) < (positions.child?.x ?? 0))
    assert.equal(positions.a, undefined)
  })

  it('snaps to multiples of 10', () => {
    const before = schemaOf([table('a')])
    const view = { ...createView(), nodes: { a: { x: 43, y: 47 } } }
    const positions = placeAdded(before, view, schemaOf([...before.tables, table('n')]), ['n'])
    assert.equal((positions.n?.x ?? 1) % 10, 0)
    assert.equal((positions.n?.y ?? 1) % 10, 0)
  })
})
```

`summarize.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'

import {
  describeSummary,
  isEmptyImport,
  limitMessages,
  summarize,
} from '../../../../lib/import/summarize.ts'

const schema: Schema = {
  version: 1,
  tables: [
    {
      id: 't1',
      name: 'a',
      columns: [
        { id: 'c1', name: 'x', type: { kind: 'text' }, nullable: true },
        { id: 'c2', name: 'y', type: { kind: 'text' }, nullable: true },
      ],
      primaryKey: [],
      indexes: [{ id: 'i', name: 'i', columns: ['c1'], unique: false, method: 'btree' }],
    },
    { id: 't2', name: 'b', columns: [], primaryKey: [] },
  ],
  relationships: [{ id: 'r', from: { tableId: 't1', columnId: 'c1' }, to: { tableId: 't2', columnId: 'c' } }],
  types: [{ kind: 'enum', id: 'e', name: 'k', values: ['a'] }],
}

describe('summarize', () => {
  it('counts tables, columns, relationships, indexes and types', () => {
    assert.deepEqual(summarize(schema), { tables: 2, columns: 2, relationships: 1, indexes: 1, types: 1 })
    assert.deepEqual(summarize({ version: 1, tables: [], relationships: [] }), {
      tables: 0, columns: 0, relationships: 0, indexes: 0, types: 0,
    })
  })
})

describe('describeSummary', () => {
  it('pluralises, and leaves out what is zero', () => {
    assert.equal(
      describeSummary({ tables: 7, columns: 28, relationships: 8, indexes: 3, types: 1 }),
      '7 tables, 28 columns, 8 relationships, 3 indexes, 1 type'
    )
    assert.equal(
      describeSummary({ tables: 1, columns: 1, relationships: 0, indexes: 0, types: 0 }),
      '1 table, 1 column'
    )
    assert.equal(describeSummary({ tables: 0, columns: 0, relationships: 0, indexes: 0, types: 0 }), 'nothing')
  })
})

describe('isEmptyImport', () => {
  it('is true only with no tables and no types', () => {
    assert.equal(isEmptyImport({ tables: 0, columns: 0, relationships: 0, indexes: 0, types: 0 }), true)
    assert.equal(isEmptyImport({ tables: 0, columns: 0, relationships: 0, indexes: 0, types: 1 }), false)
    assert.equal(isEmptyImport({ tables: 1, columns: 0, relationships: 0, indexes: 0, types: 0 }), false)
  })
})

describe('limitMessages', () => {
  it('shows the first ones and counts the rest', () => {
    assert.deepEqual(limitMessages([1, 2, 3, 4, 5], 3), { shown: [1, 2, 3], hidden: 2 })
    assert.deepEqual(limitMessages([1, 2], 3), { shown: [1, 2], hidden: 0 })
    assert.deepEqual(limitMessages([], 3), { shown: [], hidden: 0 })
  })
})
```

`limits.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { describeLimit, MAX_SQL_BYTES, tooBig } from '../../../../lib/import/limits.ts'

describe('the size limit', () => {
  it('is 2 MB, and a size over it is too big', () => {
    assert.equal(MAX_SQL_BYTES, 2 * 1024 * 1024)
    assert.equal(describeLimit(), '2 MB')
    assert.equal(tooBig(MAX_SQL_BYTES), false)
    assert.equal(tooBig(MAX_SQL_BYTES + 1), true)
    assert.equal(tooBig(0), false)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/web && for f in merge-schema place-added summarize limits; do node --test src/tests/unit/lib/import/$f.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE" | head -1; done`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for each.

- [ ] **Step 3: Implement the four modules**

`limits.ts`:

```ts
/** The longest script the dialog accepts. */
export const MAX_SQL_BYTES = 2 * 1024 * 1024

export const tooBig = (bytes: number): boolean => bytes > MAX_SQL_BYTES

export const describeLimit = (): string => `${MAX_SQL_BYTES / (1024 * 1024)} MB`
```

`summarize.ts`:

```ts
import type { Schema } from '@forge/core'

export interface ImportSummary {
  tables: number
  columns: number
  relationships: number
  indexes: number
  types: number
}

export function summarize(schema: Schema): ImportSummary {
  return {
    tables: schema.tables.length,
    columns: schema.tables.reduce((sum, table) => sum + table.columns.length, 0),
    relationships: schema.relationships.length,
    indexes: schema.tables.reduce((sum, table) => sum + (table.indexes?.length ?? 0), 0),
    types: schema.types?.length ?? 0,
  }
}

const noun = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`

export function describeSummary(summary: ImportSummary): string {
  const parts = [
    summary.tables > 0 && noun(summary.tables, 'table', 'tables'),
    summary.columns > 0 && noun(summary.columns, 'column', 'columns'),
    summary.relationships > 0 && noun(summary.relationships, 'relationship', 'relationships'),
    summary.indexes > 0 && noun(summary.indexes, 'index', 'indexes'),
    summary.types > 0 && noun(summary.types, 'type', 'types'),
  ].filter((part): part is string => part !== false)
  return parts.length === 0 ? 'nothing' : parts.join(', ')
}

export const isEmptyImport = (summary: ImportSummary): boolean =>
  summary.tables === 0 && summary.types === 0

/** The first `max` messages and how many were left out. */
export function limitMessages<T>(
  list: T[],
  max: number
): { shown: T[]; hidden: number } {
  return { shown: list.slice(0, max), hidden: Math.max(0, list.length - max) }
}
```

`merge-schema.ts`:

```ts
import type { Schema, Table, TableId, UserType } from '@forge/core'

export interface Renamed {
  kind: 'table' | 'index' | 'type'
  from: string
  to: string
}

/** `name`, or `name_2`, `name_3`… until it is free; the result is added to `taken`. */
export function freeName(name: string, taken: Set<string>): string {
  let result = name
  for (let attempt = 2; taken.has(result); attempt++) {
    result = `${name}_${attempt}`
  }
  taken.add(result)
  return result
}

/**
 * Appends an imported schema to the current one. A table, an index or a type
 * whose name is already taken is renamed, so nothing the user has is touched.
 * Relationships point at ids, which are unique already, so they survive a rename.
 */
export function mergeImported(
  current: Schema,
  imported: Schema
): { schema: Schema; addedTableIds: TableId[]; renamed: Renamed[] } {
  const tableNames = new Set(current.tables.map((table) => table.name))
  const indexNames = new Set(
    current.tables.flatMap((table) => (table.indexes ?? []).map((index) => index.name))
  )
  const typeNames = new Set((current.types ?? []).map((type) => type.name))
  const renamed: Renamed[] = []
  const rename = (kind: Renamed['kind'], name: string, taken: Set<string>) => {
    const result = freeName(name, taken)
    if (result !== name) renamed.push({ kind, from: name, to: result })
    return result
  }

  const tables = imported.tables.map((table): Table => {
    const name = rename('table', table.name, tableNames)
    const indexes = table.indexes?.map((index) => ({
      ...index,
      name: rename('index', index.name, indexNames),
    }))
    return { ...table, name, ...(indexes ? { indexes } : {}) }
  })
  const types = (imported.types ?? []).map(
    (type): UserType => ({ ...type, name: rename('type', type.name, typeNames) })
  )

  const allTypes = [...(current.types ?? []), ...types]
  const schema: Schema = {
    ...current,
    tables: [...current.tables, ...tables],
    relationships: [...current.relationships, ...imported.relationships],
    ...(allTypes.length > 0 ? { types: allTypes } : {}),
  }
  return { schema, addedTableIds: tables.map((table) => table.id), renamed }
}
```

`place-added.ts`:

```ts
import type { Schema, TableId } from '@forge/core'

import { resolvePositions } from '../canvas/to-flow.ts'
import type { Point } from '../geometry.ts'
import { nodeRect } from '../geometry.ts'
import { layoutTables } from '../layout/layout-tables.ts'
import type { ProjectView } from '../project-view.ts'

const GAP = 140
const snap = (value: number) => Math.round(value / 10) * 10

/**
 * Where the tables of an import go when it is added to a project: laid out by
 * their relationships, in a block to the right of everything already drawn,
 * level with the top of it. Existing tables are not moved.
 */
export function placeAdded(
  before: Schema,
  view: ProjectView,
  after: Schema,
  addedTableIds: TableId[]
): Record<TableId, Point> {
  const added = new Set(addedTableIds)
  const positions = resolvePositions(before, view)
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  for (const table of before.tables) {
    const position = positions[table.id] as Point
    const box = nodeRect(position, table.columns.length)
    right = Math.max(right, box.x + box.width)
    top = Math.min(top, box.y)
  }
  const origin: Point =
    before.tables.length === 0
      ? { x: 40, y: 40 }
      : { x: snap(right + GAP), y: snap(top) }

  const subset: Schema = {
    version: 1,
    tables: after.tables.filter((table) => added.has(table.id)),
    relationships: after.relationships.filter(
      (relationship) =>
        added.has(relationship.from.tableId) && added.has(relationship.to.tableId)
    ),
  }
  return layoutTables(subset, { origin })
}
```

- [ ] **Step 4: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write apps packages 2>&1 | tail -2; pnpm --filter @forge/web test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/web typecheck 2>&1 | grep -c error`
Expected: all pass, 0 type errors. If `place-added` fails on the grid fallback test, check what `resolvePositions` returns for a table without a saved position (`nextNodePosition(index)`) and fix the test's arithmetic, not the function, unless the function disagrees with how the canvas draws.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): pure helpers for importing SQL: merge with renaming, placement, summary, limits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `importSchema` store action

**Files:**
- Modify: `apps/web/src/lib/store/forge-store.ts`
- Test: `apps/web/src/tests/unit/lib/store/import-schema.test.ts`

**Interfaces:**
- Consumes: Task 1 `mergeImported`, `placeAdded`; `layoutTables`, `createView`.
- Produces on `ForgeState`: `importSchema(imported: Schema, mode: 'replace' | 'add'): void`.
- Behaviour: `replace`, or any mode when the current project has no tables and no types: `schema = imported`, `view = { ...createView(), nodes: layoutTables(imported) }`, selection, relationship selection and hover cleared, `persistence = 'ready'`, `notice = null`, `projectEpoch + 1`, `fitRequest + 1`. `add` on a non-empty project: `schema = merged`, `view.nodes` gains the positions of the added tables only, selection/relationship selection/hover cleared, `fitRequest + 1`, `projectEpoch`, `persistence`, `notice` and the viewport untouched.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Schema } from '@forge/core'
import { importSql } from '@forge/core'

import { createForgeStore } from '../../../../lib/store/forge-store.ts'

let counter = 0
const newId = () => `id-${++counter}`
function makeStore() {
  const store = createForgeStore({ newId })
  store.getState().setNewTableId('none')
  return store
}
const imported = (sql: string): Schema => importSql(sql, newId).schema

const SHOP = `
  CREATE TABLE users (id int PRIMARY KEY, name text);
  CREATE TABLE orders (id int PRIMARY KEY, user_id int REFERENCES users (id));`

describe('importSchema: replace', () => {
  it('replaces the project, lays the tables out, and clears the selection and the hover', () => {
    const store = makeStore()
    const old = store.getState().addTable()
    store.getState().select(old)
    store.getState().hoverTable(old)
    const epoch = store.getState().projectEpoch
    const fit = store.getState().fitRequest

    store.getState().importSchema(imported(SHOP), 'replace')
    const state = store.getState()
    assert.deepEqual(state.schema.tables.map((t) => t.name), ['users', 'orders'])
    assert.equal(state.schema.relationships.length, 1)
    assert.equal(state.selection, null)
    assert.equal(state.relationshipSelection, null)
    assert.equal(state.hoveredTable, null)
    assert.equal(state.projectEpoch, epoch + 1)
    assert.equal(state.fitRequest, fit + 1)
    const [users, orders] = state.schema.tables
    assert.ok(users && orders)
    assert.ok((state.view.nodes[users.id]?.x ?? 0) < (state.view.nodes[orders.id]?.x ?? 0))
    assert.equal(state.view.nodes[old], undefined)
  })

  it('also clears a "could not be read" notice and lets the project be saved again', () => {
    const store = makeStore()
    store.getState().hydrate({
      status: 'invalid',
      errors: [{ path: 'schema', message: 'bad' }],
    } as never)
    assert.equal(store.getState().persistence, 'blocked')
    store.getState().importSchema(imported(SHOP), 'replace')
    assert.equal(store.getState().persistence, 'ready')
    assert.equal(store.getState().notice, null)
  })
})

describe('importSchema: add', () => {
  it('keeps what is there, renames what collides, and places only the new tables to the right', () => {
    const store = makeStore()
    store.getState().importSchema(imported(SHOP), 'replace')
    const before = store.getState()
    const viewport = { x: 5, y: 6, zoom: 2 }
    store.getState().setViewport(viewport)
    const epoch = store.getState().projectEpoch
    const fit = store.getState().fitRequest
    const oldPositions = { ...store.getState().view.nodes }

    store.getState().importSchema(imported('CREATE TABLE users (id int PRIMARY KEY); CREATE TABLE items (id int);'), 'add')
    const state = store.getState()
    assert.deepEqual(state.schema.tables.map((t) => t.name), ['users', 'orders', 'users_2', 'items'])
    assert.equal(state.schema.relationships.length, before.schema.relationships.length)
    for (const [id, position] of Object.entries(oldPositions)) {
      assert.deepEqual(state.view.nodes[id], position)
    }
    const rightEdge = Math.max(...Object.values(oldPositions).map((p) => p.x)) + 220
    for (const table of state.schema.tables.slice(2)) {
      assert.ok((state.view.nodes[table.id]?.x ?? 0) > rightEdge)
    }
    assert.deepEqual(state.view.viewport, viewport)
    assert.equal(state.projectEpoch, epoch)
    assert.equal(state.fitRequest, fit + 1)
    assert.equal(state.selection, null)
  })

  it('is a replace when the project has no tables and no types', () => {
    const store = makeStore()
    const epoch = store.getState().projectEpoch
    store.getState().importSchema(imported(SHOP), 'add')
    assert.equal(store.getState().schema.tables.length, 2)
    assert.equal(store.getState().projectEpoch, epoch + 1)
  })

  it('autosaves like any change: the schema in the store is the merged one', () => {
    const store = makeStore()
    store.getState().addTable()
    store.getState().importSchema(imported(SHOP), 'add')
    assert.equal(store.getState().schema.tables.length, 3)
  })
})
```

If `hydrate` takes a different argument shape for an unreadable project, build the blocked state the way the existing store tests do (search `persistence` in `forge-store.test.ts`) instead of the `as never` cast.

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/web && node --test src/tests/unit/lib/store/import-schema.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL (`importSchema is not a function`).

- [ ] **Step 3: Implement**

In `forge-store.ts` add the imports `mergeImported` (`../import/merge-schema.ts`) and `placeAdded` (`../import/place-added.ts`); add to `ForgeState` next to `loadExample`:

```ts
  /**
   * Puts an imported schema in the project: `replace` swaps the project for it,
   * `add` appends it, renaming what collides. An empty project is always a replace.
   */
  importSchema: (imported: Schema, mode: 'replace' | 'add') => void
```

and the action, after `loadExample`:

```ts
    importSchema: (imported, mode) => {
      const { schema, view } = get()
      const empty = schema.tables.length === 0 && (schema.types ?? []).length === 0
      if (mode === 'replace' || empty) {
        set({
          schema: imported,
          view: { ...createView(), nodes: layoutTables(imported) },
          selection: null,
          relationshipSelection: null,
          hoveredTable: null,
          persistence: 'ready',
          notice: null,
          projectEpoch: get().projectEpoch + 1,
          fitRequest: get().fitRequest + 1,
        })
        return
      }
      const merged = mergeImported(schema, imported)
      const positions = placeAdded(schema, view, merged.schema, merged.addedTableIds)
      set({
        schema: merged.schema,
        view: { ...view, nodes: { ...view.nodes, ...positions } },
        selection: null,
        relationshipSelection: null,
        hoveredTable: null,
        fitRequest: get().fitRequest + 1,
      })
    },
```

- [ ] **Step 4: Run the tests**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write apps packages 2>&1 | tail -2; pnpm --filter @forge/web test 2>&1 | grep -E "ℹ (tests|pass|fail)|^✖"; pnpm --filter @forge/web typecheck 2>&1 | grep -c error`
Expected: all pass, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): importSchema, to replace the project or add to it

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The import dialog and the toolbar button

**Files:**
- Create: `apps/web/src/components/import/import-dialog.tsx`
- Modify: `apps/web/src/components/toolbar/toolbar.tsx`, `apps/web/src/styles.css`
- Test: verified by typecheck, lint and the e2e of Task 4 (the component has no logic that is not already in the tested helpers).

**Interfaces:**
- Consumes: `importSql`, `ImportResult` from `@forge/core`; Task 1 helpers; Task 2 `importSchema`; `ConfirmButton`; `forgeStore`, `useForgeStore`.
- Produces: `ImportDialog({ onClose })`, a modal `<dialog aria-label='Import SQL'>`; and the toolbar button `Import SQL`. Accessible names the e2e relies on: textarea `SQL`; file input `SQL file`; the preview region `Import preview` (contains the sentence from `describeSummary`, the warning list `Warnings` and the error list `Errors`); radios `Add to the project` and `Replace the project` (only when the project has tables); buttons `Import` (or, for Replace, `Replace the project with this script` that arms to `Click again to replace the project`), `Cancel`. The `Import` button is disabled while there are errors, nothing to import, or no text.

- [ ] **Step 1: Create `import-dialog.tsx`**

```tsx
import type { ImportResult } from '@forge/core'
import { importSql } from '@forge/core'
import { useState } from 'react'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import { describeLimit, tooBig } from '../../lib/import/limits.ts'
import {
  describeSummary,
  isEmptyImport,
  limitMessages,
  summarize,
} from '../../lib/import/summarize.ts'
import { ConfirmButton } from '../confirm-button.tsx'

const MAX_LISTED = 100

type Mode = 'add' | 'replace'

interface Parsed {
  text: string
  result: ImportResult
}

function parse(text: string): Parsed {
  return { text, result: importSql(text, () => crypto.randomUUID()) }
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const hasTables = useForgeStore((state) => state.schema.tables.length > 0)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mode, setMode] = useState<Mode>('add')
  const [fileError, setFileError] = useState<string | null>(null)

  function change(text: string) {
    setFileError(null)
    if (tooBig(new Blob([text]).size)) {
      setParsed(null)
      setFileError(`The script is over ${describeLimit()}.`)
      return
    }
    setParsed(text.trim() === '' ? null : parse(text))
  }

  async function loadFile(file: File | undefined) {
    if (!file) return
    if (tooBig(file.size)) {
      setParsed(null)
      setFileError(`"${file.name}" is over ${describeLimit()}.`)
      return
    }
    change(await file.text())
  }

  const summary = parsed ? summarize(parsed.result.schema) : null
  const errors = parsed?.result.errors ?? []
  const warnings = parsed?.result.warnings ?? []
  const canImport =
    parsed !== null &&
    summary !== null &&
    errors.length === 0 &&
    !isEmptyImport(summary)
  const replacing = hasTables && mode === 'replace'

  function run() {
    if (!parsed || !canImport) return
    forgeStore
      .getState()
      .importSchema(parsed.result.schema, replacing ? 'replace' : 'add')
    onClose()
  }

  const shownWarnings = limitMessages(warnings, MAX_LISTED)
  const shownErrors = limitMessages(errors, MAX_LISTED)

  return (
    <dialog
      className='import-dialog'
      aria-label='Import SQL'
      ref={(element) => {
        if (element && !element.open) element.showModal()
      }}
      onClose={onClose}>
      <h2 className='import-dialog__title'>Import SQL</h2>
      <p className='inspector__hint'>
        Paste a PostgreSQL script or load a .sql file. Tables, columns, primary
        and foreign keys, indexes, comments, enums and domains are imported;
        anything else is listed below and skipped.
      </p>

      <label className='field'>
        SQL
        <textarea
          aria-label='SQL'
          className='import-dialog__text'
          rows={10}
          spellCheck={false}
          placeholder='CREATE TABLE users (id integer PRIMARY KEY, …);'
          defaultValue={parsed?.text ?? ''}
          onChange={(event) => change(event.target.value)}
        />
      </label>
      <label className='field'>
        Or a file
        <input
          type='file'
          accept='.sql,text/plain'
          aria-label='SQL file'
          onChange={(event) => loadFile(event.target.files?.[0])}
        />
      </label>
      {fileError && (
        <p role='alert' className='import-dialog__error'>
          {fileError}
        </p>
      )}

      <section aria-label='Import preview' className='import-dialog__preview'>
        {summary === null ? (
          <p className='inspector__hint'>Nothing to preview yet.</p>
        ) : (
          <>
            <p>
              <strong>This script has {describeSummary(summary)}.</strong>
            </p>
            {errors.length > 0 && (
              <>
                <h3 className='inspector__heading'>Errors</h3>
                <ul aria-label='Errors' className='import-dialog__list'>
                  {shownErrors.shown.map((error) => (
                    <li key={`${error.line}:${error.statement}:${error.message}`}>
                      {error.line > 0 ? `line ${error.line}: ` : ''}
                      {error.message}
                    </li>
                  ))}
                </ul>
                {shownErrors.hidden > 0 && (
                  <p className='inspector__hint'>…and {shownErrors.hidden} more.</p>
                )}
              </>
            )}
            {warnings.length > 0 && (
              <>
                <h3 className='inspector__heading'>
                  Skipped or changed ({warnings.length})
                </h3>
                <ul aria-label='Warnings' className='import-dialog__list'>
                  {shownWarnings.shown.map((warning) => (
                    <li key={`${warning.line}:${warning.statement}:${warning.message}`}>
                      line {warning.line}: {warning.message}
                    </li>
                  ))}
                </ul>
                {shownWarnings.hidden > 0 && (
                  <p className='inspector__hint'>…and {shownWarnings.hidden} more.</p>
                )}
              </>
            )}
          </>
        )}
      </section>

      {hasTables && (
        <fieldset className='import-dialog__mode'>
          <legend>The project already has tables</legend>
          <label>
            <input
              type='radio'
              name='import-mode'
              checked={mode === 'add'}
              onChange={() => setMode('add')}
            />
            Add to the project
          </label>
          <label>
            <input
              type='radio'
              name='import-mode'
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            Replace the project
          </label>
        </fieldset>
      )}

      <div className='import-dialog__actions'>
        {replacing ? (
          <ConfirmButton
            label='Replace the project with this script'
            armedLabel='Click again to replace the project'
            onConfirm={run}
          />
        ) : (
          <button type='button' disabled={!canImport} onClick={run}>
            Import
          </button>
        )}
        <button type='button' onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}
```

A `ConfirmButton` has no `disabled`; when `replacing`, wrap the decision so it cannot run an invalid import: `run` already returns when `!canImport`, and the label should still read as unavailable, so render `<button type='button' disabled>Replace the project with this script</button>` instead of the `ConfirmButton` while `!canImport`.

- [ ] **Step 2: Wire the toolbar**

In `toolbar.tsx`, add `import { useState } from 'react'` and `import { ImportDialog } from '../import/import-dialog.tsx'`, inside `Toolbar` `const [importing, setImporting] = useState(false)`, a button after "Load example":

```tsx
      <button type='button' onClick={() => setImporting(true)}>
        Import SQL
      </button>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
```

(`<dialog>` is modal and portals itself to the top layer, so it can live inside the header.)

- [ ] **Step 3: Style it**

Append to `styles.css`:

```css
.import-dialog {
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  padding: 16px;
  overflow: auto;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.import-dialog::backdrop {
  background: rgb(0 0 0 / 40%);
}

.import-dialog__title {
  margin: 0 0 8px;
  font-size: 16px;
}

.import-dialog__text {
  box-sizing: border-box;
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

.import-dialog__preview {
  margin: 12px 0;
}

.import-dialog__list {
  max-height: 180px;
  margin: 4px 0;
  padding-left: 18px;
  overflow: auto;
  font-size: 12px;
}

.import-dialog__error {
  color: var(--error-text);
}

.import-dialog__mode {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 12px;
}

.import-dialog__actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 4: Verify**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm exec biome check --write apps packages 2>&1 | tail -3; pnpm typecheck 2>&1 | grep -ci error; pnpm --filter @forge/web test 2>&1 | grep -E "ℹ (pass|fail)"; cd apps/e2e && pnpm exec playwright test --workers=3 --reporter=line 2>&1 | grep -E "passed|failed"`
Expected: lint clean, 0 type errors, unit tests pass, the existing e2e suite still passes. A Biome a11y complaint about the `<dialog>` ref callback is resolved by keeping `showModal()` in the ref callback; do not add a suppression unless Biome names a rule, and then state the reason in it.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): Import SQL dialog with a live preview, in the toolbar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: e2e, docs and the gate

**Files:**
- Create: `apps/e2e/tests/import-sql.spec.ts`
- Create: `docs/adr/0008-sql-import.md`
- Modify: `apps/web/GLOSSARY.md`

**Interfaces:**
- Consumes: everything above; the `Editor` helper (`open`, `tables`, `edges`, `node`, `showDdl`, `ddl`).

- [ ] **Step 1: Write the e2e spec**

`apps/e2e/tests/import-sql.spec.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

const SHOP = `
CREATE TYPE order_status AS ENUM ('pending', 'paid');
CREATE TABLE users (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE orders (
  id integer PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id),
  status order_status DEFAULT 'pending'
);
CREATE INDEX idx_orders_user ON orders (user_id);
COMMENT ON TABLE users IS 'People';
INSERT INTO users VALUES (1, 'a@b.c');
`

async function openImport(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 })
  const editor = new Editor(page)
  await editor.open()
  return editor
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Import SQL' })
const sqlBox = (page: Page) => dialog(page).getByLabel('SQL', { exact: true })

test.describe('importing SQL', () => {
  test('pasting a script shows a preview with counts and a skipped statement with its line', async ({ page }) => {
    await openImport(page)
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await sqlBox(page).fill(SHOP)

    const preview = dialog(page).getByRole('region', { name: 'Import preview' })
    await expect(preview).toContainText('This script has 2 tables, 6 columns, 1 relationship, 2 indexes, 1 type.')
    await expect(preview.getByRole('list', { name: 'Warnings' })).toContainText('INSERT INTO statements are not modelled')
    await expect(preview.getByRole('list', { name: 'Warnings' })).toContainText('line 16')
    await expect(dialog(page).getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
  })

  test('importing into an empty project creates the tables and the relationship, laid out by it', async ({ page }) => {
    const editor = await openImport(page)
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await sqlBox(page).fill(SHOP)
    await dialog(page).getByRole('button', { name: 'Import', exact: true }).click()

    await expect(dialog(page)).toHaveCount(0)
    await expect(editor.tables()).toHaveCount(2)
    await expect(editor.edges()).toHaveCount(1)
    const left = async (name: string) => (await editor.node(name).locator('.table-node').boundingBox())?.x ?? NaN
    expect(await left('users')).toBeLessThan(await left('orders'))

    const sql = await editor.ddl()
    expect(sql).toContain('CREATE TYPE "order_status" AS ENUM')
    expect(sql).toContain('"id" integer NOT NULL GENERATED BY DEFAULT AS IDENTITY')
    expect(sql).toContain('"created_at" timestamptz NOT NULL DEFAULT now()')
    expect(sql).toContain("COMMENT ON TABLE \\"users\\" IS 'People';")
  })

  test('a script with a syntax error cannot be imported, and the error says which line', async ({ page }) => {
    await openImport(page)
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await sqlBox(page).fill('CREATE TABLE a (x int);\nCREATE TABLE b (y);')
    const preview = dialog(page).getByRole('region', { name: 'Import preview' })
    await expect(preview.getByRole('list', { name: 'Errors' })).toContainText('line 2')
    await expect(dialog(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
  })

  test('a script with nothing to import cannot be imported', async ({ page }) => {
    await openImport(page)
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await sqlBox(page).fill('SET search_path = public;')
    await expect(dialog(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
  })

  test('a .sql file can be loaded, and its text appears in the box', async ({ page }) => {
    const editor = await openImport(page)
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'forge-')), 'schema.sql')
    writeFileSync(file, 'CREATE TABLE from_file (id int PRIMARY KEY);')
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await dialog(page).getByLabel('SQL file').setInputFiles(file)
    await expect(dialog(page).getByRole('region', { name: 'Import preview' })).toContainText('1 table')
    await dialog(page).getByRole('button', { name: 'Import', exact: true }).click()
    await expect(editor.node('from_file')).toBeVisible()
  })

  test('a file over 2 MB is refused', async ({ page }) => {
    await openImport(page)
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'forge-')), 'big.sql')
    writeFileSync(file, `-- ${'x'.repeat(2 * 1024 * 1024 + 10)}\n`)
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await dialog(page).getByLabel('SQL file').setInputFiles(file)
    await expect(dialog(page).getByRole('alert')).toContainText('over 2 MB')
    await expect(dialog(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
  })

  test('adding to a project keeps its tables, renames a collision and places the new ones to the right', async ({ page }) => {
    const editor = await openImport(page)
    await editor.defineTable('users', [{ name: 'id', type: 'integer', primaryKey: true }])
    const before = (await editor.node('users').locator('.table-node').boundingBox())?.x ?? NaN

    await page.getByRole('button', { name: 'Import SQL' }).click()
    await sqlBox(page).fill('CREATE TABLE users (id int PRIMARY KEY); CREATE TABLE items (id int);')
    await expect(dialog(page).getByLabel('Add to the project')).toBeChecked()
    await dialog(page).getByRole('button', { name: 'Import', exact: true }).click()

    await expect(editor.tables()).toHaveCount(3)
    await expect(editor.node('users_2')).toBeVisible()
    await expect(editor.node('items')).toBeVisible()
    const first = (await editor.node('users').locator('.table-node').boundingBox())?.x ?? NaN
    const added = (await editor.node('items').locator('.table-node').boundingBox())?.x ?? NaN
    expect(added).toBeGreaterThan(first)
    expect(before).toBeGreaterThan(-1)
  })

  test('replacing the project needs a second click, and then only the script remains', async ({ page }) => {
    const editor = await openImport(page)
    await editor.defineTable('mine', [{ name: 'id', type: 'integer' }])
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await sqlBox(page).fill('CREATE TABLE only_this (id int);')
    await dialog(page).getByLabel('Replace the project').check()
    await dialog(page).getByRole('button', { name: 'Replace the project with this script' }).click()
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Click again to replace the project' }).click()

    await expect(editor.tables()).toHaveCount(1)
    await expect(editor.node('only_this')).toBeVisible()
  })

  test('Cancel and Escape close the dialog and change nothing', async ({ page }) => {
    const editor = await openImport(page)
    await editor.addTable('kept')
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await sqlBox(page).fill('CREATE TABLE nope (id int);')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(editor.tables()).toHaveCount(1)
  })

  test('an imported project is saved: a reload shows it', async ({ page }) => {
    const editor = await openImport(page)
    await page.getByRole('button', { name: 'Import SQL' }).click()
    await sqlBox(page).fill('CREATE TABLE persisted (id int PRIMARY KEY);')
    await dialog(page).getByRole('button', { name: 'Import', exact: true }).click()
    await expect(editor.node('persisted')).toBeVisible()
    await page.reload()
    await expect(editor.node('persisted')).toBeVisible()
  })

  test('hundreds of skipped statements stay readable: the list is capped', async ({ page }) => {
    await openImport(page)
    await page.getByRole('button', { name: 'Import SQL' }).click()
    const noise = Array.from({ length: 300 }, (_, i) => `INSERT INTO t VALUES (${i});`).join('\n')
    await sqlBox(page).fill(`CREATE TABLE t (id int);\n${noise}`)
    const warnings = dialog(page).getByRole('list', { name: 'Warnings' })
    await expect(warnings.locator('li')).toHaveCount(100)
    await expect(dialog(page)).toContainText('…and 200 more.')
  })
})
```

Selectors are written against the names this plan defines; if a locator does not resolve, fix the **locator** (or the component's accessible name) rather than weakening an assertion. The first test's counts (`2 tables, 6 columns, 1 relationship, 2 indexes, 1 type`) assume the `UNIQUE` on `users.email` becomes an index (so 2 indexes with `idx_orders_user`) and that `INSERT` is on line 16 of `SHOP` as written; recount if the script is edited.

- [ ] **Step 2: Run the e2e and iterate until green**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge/apps/e2e && pnpm exec biome check --write . 2>&1 | tail -1; pnpm exec playwright test tests/import-sql.spec.ts --workers=3 --reporter=line 2>&1 | grep -vE "attachment|────|^\s*$|test-results|Usage|show-trace" | head -60`
Expected: all pass after fixing any real defect found (these tests are written after the component; a failure is a finding, so find the cause).

- [ ] **Step 3: Docs**

`docs/adr/0008-sql-import.md` (system-wide ADR): status accepted; context (the app must build a diagram from a script); decision: three layers (model additions in the core, `importSql` parser in the core, the dialog in the web), the dialog parses on change and imports the very schema it previewed; **Add** vs **Replace** with a second click for Replace, renaming of table, index and type names on collision, ids not remapped; Add places only the new tables to the right and leaves the viewport; Replace lays out everything and resets the canvas; errors block the import, warnings do not; 2 MB limit; no drag and drop. Consequences: renames on Add are applied silently and are visible as the new names in the diagram (the dialog does not list them); large scripts are parsed on the main thread on every change (a web worker is the next step if that ever matters). Link the two core ADRs (0007, 0008 of `packages/core/docs/adr`).

`apps/web/GLOSSARY.md`: add **Import dialog** (opened by the toolbar's "Import SQL"; paste or file; live **preview**; **Add** or **Replace**), **Preview** (the counts and the lists of errors and skipped statements, from `importSql`, shown before anything is imported; errors disable Import), **Add** (appends, renames collisions with `_2`, `_3`…, places new tables right of the existing ones) and **Replace** (swaps the whole project; asks for a second click).

- [ ] **Step 4: Final gate**

Run: `export PATH="$(mise where node)/bin:$PATH"; cd /home/cristian.giehl@koch.intranet/orca/projects/forge && pnpm lint && pnpm typecheck && pnpm test 2>&1 | grep -E "ℹ (tests|pass|fail)" && pnpm build 2>&1 | tail -1 && (cd apps/e2e && pnpm exec playwright test --workers=3 --reporter=line 2>&1 | grep -E "passed|failed")`
Expected: all green. Then take a screenshot of the open dialog with a preview that has warnings and the project not empty (Replace/Add visible), look at it, and check that nothing overflows the dialog.

- [ ] **Step 5: Commit**

```bash
git add -A apps docs
git commit -m "test(e2e): importing SQL; ADR and glossary for the import dialog

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
