# Slice 1: draw tables, generate PostgreSQL DDL

## Goal

The first vertical slice proves the whole Forge loop with the smallest surface: a user draws tables and relationships on a canvas, sees the PostgreSQL DDL generated from them, and finds the project still there after a reload. It exercises the domain model (`@forge/core`), the canvas and editing UI (`@forge/web`), and local persistence end to end. It deliberately leaves out the SQL parser, the riskiest part, for a later slice.

DDL (Data Definition Language) is the part of SQL that defines structure: `CREATE TABLE`, `ALTER TABLE`. "Generate DDL" means turning the drawn schema into a script the user can copy and run on PostgreSQL.

## Scope

**In:**
- Tables, columns (name, logical type, nullable), primary keys (including composite), and single-column foreign-key relationships.
- A PostgreSQL dialect behind a dialect interface.
- DDL generation, shown in a panel with a copy button.
- One project, autosaved to `localStorage` and loaded on open.

**Out (later slices):** SQL parser; other dialects (MySQL, Oracle); `UNIQUE`, `DEFAULT`, indexes; composite foreign keys; undo/redo; multiple projects; import/export of files; automatic layout; authentication and `apps/api`.

## Decisions taken while designing

| Decision | Choice | Alternatives rejected |
|---|---|---|
| First flow | Draw, then generate DDL | Paste SQL then diagram; both directions at once |
| Dialects | PostgreSQL only, behind an interface | PostgreSQL + MySQL; PostgreSQL + Oracle |
| Schema elements | Minimal core: tables, columns, PK, FK | + unique/default; + indexes |
| Column type | Logical type, mapped per dialect | Direct PostgreSQL type; free text |
| Editing | Side inspector; table node is read-only | Inline editing in the node; both |
| Core model | Immutable data and pure functions | Mutable classes; commands with undo |
| Persistence hooks | TanStack Query in `queries/project/` | Plain hooks |

## `@forge/core`

All data is plain and JSON-serializable. IDs are strings supplied by the caller: the core does not call `crypto` or any platform API (ADR-0001).

```
Schema        { version: 1, tables: Table[], relationships: Relationship[] }
Table         { id, name, columns: Column[], primaryKey: ColumnId[] }
Column        { id, name, type: ColumnType, nullable }
ColumnType    integer | bigint | text | boolean | uuid | timestamp | date | json
              | varchar(length) | numeric(precision, scale)
Relationship  { id, from: { tableId, columnId }, to: { tableId, columnId } }
```

A relationship reads "`from` references `to`" and becomes a `FOREIGN KEY`.

**Operations** are pure functions returning a new `Schema`: `addTable`, `renameTable`, `removeTable`, `addColumn`, `updateColumn`, `removeColumn`, `setPrimaryKey`, `addRelationship`, `removeRelationship`. Removing a table or column also removes the relationships and primary-key entries that depended on it.

**Validation.** `validate(schema)` returns a list of issues (it never throws). Each issue has a `code`, a `message`, and the ids it concerns. Rules:

- empty table name; empty column name;
- duplicate table name; duplicate column name within a table;
- a column that is the source of more than one relationship (one foreign key per column, which also keeps the derived constraint names unique);
- relationship whose two columns have incompatible types;
- relationship whose target is not the sole primary-key column of its table. PostgreSQL requires a foreign key to reference a unique column, and `UNIQUE` is out of scope, so the target must be a single-column primary key. A foreign key therefore cannot reference part of a composite primary key.

`checkRelationship(schema, from, to)` returns the issue that would result from adding that relationship, or `null`. The web uses it to refuse an invalid connection while dragging, so the rule exists in one place.

### Dialects and DDL generation

```
Dialect { id, typeName(type: ColumnType): string, quoteIdentifier(name): string }
```

The PostgreSQL dialect maps `integer`, `bigint`, `text`, `boolean`, `uuid`, `date`, `varchar(n)` and `numeric(p,s)` one to one, with two renames: `json` becomes `jsonb`, and `timestamp` becomes `timestamptz` (the logical `timestamp` means an instant in time).

`generateDdl(schema, dialect)` is pure and returns `{ ok: true, sql }` or `{ ok: false, issues }`. It generates only for a schema with no validation issues.

- One `CREATE TABLE` per table, with columns, `NOT NULL` where a column is not nullable, and the `PRIMARY KEY` inline.
- A foreign key is declared inside the `CREATE TABLE` of the table that holds it, as a named constraint after the primary key, and a table is created right after the tables it references. A reference that would point at a table not yet created (a cycle) is the only one written as an `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` after every table exists (core ADR-0006).
- Identifiers are always double-quoted, with `"` escaped as `""`. The user's names are preserved, including case.
- Constraint names are derived and deterministic (`fk_<table>_<column>`), truncated to 63 characters, the PostgreSQL limit. They are not user-editable in this slice.

### Project document

```
Project { formatVersion: 1, schema: Schema, view: <opaque JSON> }
```

`@forge/core` owns the envelope, the versioning, and the validation of `schema`: `parseProject(unknown)` returns the project or a list of errors, including structural ones such as a relationship pointing at a table that does not exist. `view` is opaque JSON that the core only passes through. Its content is defined by the web: node positions and the viewport. This keeps positions out of the core, in line with the vocabulary boundary in `GLOSSARY-MAP.md`, while the saved format and its version stay in the core as the existing ADRs state.

## `@forge/web`

### State

A Zustand store with three slices:

- `schema`: the core `Schema`;
- `view`: node positions keyed by table id, and the viewport;
- `selection`: the selected table id, or none.

Each action calls a core operation and replaces only what changed (ADR-0003). IDs are generated in the web with `crypto.randomUUID()`. Validation issues are not stored: they are derived from `validate(schema)` on every change.

### Canvas

Two pure functions in `lib/canvas/` convert the store state into React Flow nodes and edges. A table node renders its table read-only, with one `<Handle>` per column whose id is the column id. Dragging from one column to another creates a relationship; `isValidConnection` calls `checkRelationship`. Moving a node writes its position to `view`. Adding or removing a column calls `useUpdateNodeInternals` (ADR-0002).

### Screens

- `toolbar/`: "New table" and the button that opens the DDL panel.
- `inspector/`: opens when a table is selected; edits the table name and its columns (name, type, nullable, primary key), and removes columns or the table.
- DDL panel: read-only SQL with a "Copy" button; when the schema has issues, it lists them instead of the SQL.

### Persistence

`lib/storage/` defines a `load`/`save` interface and a `localStorage` adapter (key `forge:project`). The adapter receives a `Storage`-like object (`getItem`/`setItem`) instead of reaching for the global, so it can be exercised under Node.

`queries/project/` contains TanStack Query hooks (`@tanstack/react-query` is added in this slice). The query and mutation functions (`loadProject(storage)`, `saveProject(storage, project)`) are plain exported functions, and the hooks are thin wrappers around them. This keeps the logic testable without rendering anything (ADR-0001 of the web).

The project is saved automatically, debounced by about 500 ms after any change to `schema` or `view`, and loaded when the app opens. If the stored JSON fails `parseProject`, the web shows the error and does **not** overwrite what is stored until the user chooses to start a new project.

## Testing

Tests follow the existing ADRs: `node:test`, centralized under `src/tests/{unit,integration}`, no rendering and no end-to-end tests.

**`@forge/core`:**
- unit: every operation (including the cascade on removal), every validation rule, `checkRelationship`, type mapping and identifier quoting for PostgreSQL, `parseProject` accepts and rejects.
- integration: schema to `generateDdl` against golden SQL strings, including a composite primary key, a foreign key, a mixed-case name, and a quote inside a name; `parseProject` round trip.

**`@forge/web`:**
- unit: the canvas conversion functions, the store actions, the `localStorage` adapter with an injected fake storage.
- integration (`integration/project/`): `loadProject` and `saveProject` over the real adapter and a fake storage, including a corrupt stored value that must not be overwritten.
- Not tested by design: React components, the React Flow wiring, and the TanStack Query hooks. They hold no logic of their own.

## Acceptance criteria

1. The user can add a table, rename it, add columns of every logical type, mark nullability, and set a simple or composite primary key.
2. Dragging a column to another creates a foreign key; a connection that breaks a rule is refused.
3. The DDL panel shows the expected PostgreSQL script, and lists the issues instead when the schema is invalid.
4. After a reload, the schema, node positions, and viewport are restored.
5. A corrupted stored value is reported and is not overwritten.
6. `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.

## To record after this spec

- Glossaries: `packages/core/GLOSSARY.md` (Schema, Table, Column, ColumnType, Relationship, Dialect, DDL, Project) and `apps/web/GLOSSARY.md` (Node, Viewport, Selection, Inspector, view).
- ADRs in `packages/core/docs/adr/`: immutable data and pure operations; logical column types mapped per dialect; project envelope with an opaque `view`.
- ADR in `apps/web/docs/adr/`: TanStack Query for the persistence hooks.
