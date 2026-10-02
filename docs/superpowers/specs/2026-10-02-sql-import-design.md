# SQL import: paste or load a `.sql` and get tables and relationships

Status: approved in conversation, awaiting written-spec review.

## Intent

The user pastes a SQL script, or loads a `.sql` file, and Forge creates the
tables and relationships from it, laid out by the relationships. PostgreSQL
only. What Forge generates must read back to the same schema (round-trip), and
what Forge does not model is reported, never silently lost.

Decisions taken with the user:

1. **Existing project:** the import dialog asks every time: **Replace** the
   project or **Add** to it.
2. **Name conflicts when adding:** the imported table is renamed with a suffix
   (`users` becomes `users_2`); the imported foreign keys follow the renamed
   table. The same rule applies to index and type names. Nothing existing is
   touched.
3. **Unsupported or invalid SQL:** a **preview** is shown before confirming,
   with what will be created and what will be ignored. Unsupported statements
   are warnings with their line; a syntax error in a statement Forge should
   understand is an error that blocks the import.
4. **Parser:** written by hand in `@forge/core` (no dependency), a tokenizer
   plus a recursive-descent parser for the subset Forge models.
5. **The model grows first** so nothing the parser reads has to be dropped:
   indexes (with `UNIQUE`), comments, raw `DEFAULT` expressions, more column
   types, and `CREATE TYPE` (enums and simple domains).
6. **Comments are visible:** a column row (or table title) that has a comment
   shows an icon; hovering it shows the comment.

## Decomposition

Three sub-projects, each with its own plan, tests and commits, in this order:

1. **Model** (core + web editing): the additions below, DDL generation,
   Inspector editing, canvas display.
2. **Parser** (core): `importSql`.
3. **Import dialog** (web): paste/file, preview, Replace/Add.

Each leaves the app working and green on its own. Sub-project 2 depends on 1;
3 depends on 2.

## 1. Model

All data stays immutable; operations stay pure (ADR-0002 of core).

- `Column` gains `default?: string` (a raw SQL expression, re-emitted as
  written) and `comment?: string`. `generated` and `default` are mutually
  exclusive (validation issue).
- `Table` gains `comment?: string` and `indexes: Index[]`.
  `Index = { id, name, columns: ColumnId[], unique: boolean, method: 'btree' | 'hash' | 'gin' | 'gist' }`.
- `Schema` gains `types: UserType[]`:
  `{ kind: 'enum', id, name, values: string[] }` or
  `{ kind: 'domain', id, name, base: ColumnType, notNull?: boolean, default?: string }`.
  A domain's `CHECK` is not modelled.
- `ColumnType` gains the native kinds `smallint`, `real`, `double`, `char(n)`,
  `time`, `timestamp-naive` (without time zone), `interval`, `bytea`, `jsonb`;
  an array form `{ kind: 'array', of: ColumnType }`; and
  `{ kind: 'user', typeId }`. `serial` is not a kind: it is read as
  `integer` + `generated`.
- Compatibility: new fields are optional or default to empty (`indexes: []`,
  `types: []`); `parseProject` fills them in, so projects saved earlier remain
  valid and `formatVersion` stays 1.
- Validation: index names unique across the schema (as in PostgreSQL), type
  names unique, index columns exist and are not repeated, enum values
  non-empty and distinct, `user` types reference an existing type, a type in
  use cannot be removed (operation refuses; the UI lists the columns that use
  it).
- Logical types are mapped per dialect (ADR-0003 of core): the PostgreSQL
  dialect maps the new kinds and arrays (`integer[]`) and user types.

### DDL generation

Order: `CREATE TYPE` / `CREATE DOMAIN`, then `CREATE TABLE` (existing
foreign-key ordering), then `CREATE [UNIQUE] INDEX … USING method`, then
`COMMENT ON TABLE` / `COMMENT ON COLUMN`. Statements keep the `DdlStatement`
tagging with a table id; type statements have no table. Defaults are emitted
after the type: `DEFAULT <raw>`.

### Inspector and canvas

- Per column: `Default` text field (disabled while Auto-generate is on, and
  the other way round), `Comment` field, the type selector with the new native
  kinds, a "Custom types" group and an "array of" toggle.
- Per table: `Comment` field and an **Indexes** list (name, columns in order,
  Unique, method; "Add index"; remove with a second click). Default names:
  `idx_<table>_<columns>`, `uq_<table>_<columns>` for unique.
- With no table selected the Inspector shows **Types**: enums (name, values)
  and domains (name, base type, not null, default), "Add enum" / "Add domain".
- Canvas: a commented column row shows an icon; hover shows the comment in a
  tooltip (own component, quick, multi-line). A commented table shows the icon
  in its title. The icon fits the fixed 26 px row: node geometry does not
  change. Indexes and types are not drawn in the node, except a "UQ" badge on a
  column that has a single-column unique index. Type names (`status_enum`) and
  arrays (`integer[]`) show in the type cell.
- DDL hover: a table also highlights its `CREATE INDEX` and `COMMENT ON`
  statements. `CREATE TYPE` / `CREATE DOMAIN` highlight only within the panel.

## 2. Parser

`importSql(sql: string, newId: () => string) → { schema, warnings, errors }`
in `@forge/core`. `warnings` and `errors` carry `{ line, statement, message }`.

- **Tokenizer:** `--` and `/* */` comments, quoted identifiers, strings
  (`''`, `E'…'`), dollar quoting, case-insensitive keywords, line of each
  token. Statements split at `;` outside strings, comments and `$$`.
- **Parser:** one statement at a time; a failure in one statement does not stop
  the others but is reported.
- **Read:** `CREATE TABLE` (columns, types incl. arrays and user types,
  `NULL`/`NOT NULL`, `DEFAULT`, `PRIMARY KEY` inline or table-level, inline
  `UNIQUE` as a unique index, inline `REFERENCES`, `CONSTRAINT … FOREIGN KEY`),
  `ALTER TABLE … ADD CONSTRAINT` (FK, PK, UNIQUE), basic
  `CREATE [UNIQUE] INDEX`, `CREATE TYPE … AS ENUM`, `CREATE DOMAIN`,
  `COMMENT ON TABLE/COLUMN`.
- **Recognised as `generated`:** `GENERATED … AS IDENTITY`, `serial` /
  `bigserial`, `DEFAULT now()` or `CURRENT_TIMESTAMP` on a timestamp,
  `gen_random_uuid()` on a uuid. Any other default is kept raw in `default`.
- **Names:** `public.users` loses `public.`; another schema is a warning and the
  prefix is dropped.
- **Warnings (ignored, with line):** `CHECK`, indexes with `WHERE`,
  expressions, `INCLUDE` or ordering, composite foreign keys, composite types,
  `INSERT`/`COPY`, `CREATE VIEW/FUNCTION/TRIGGER/EXTENSION`, `SET`,
  `BEGIN`/`COMMIT`. A foreign key to an unknown table or column is a warning
  and is dropped.
- **Errors:** a syntax error in a statement Forge should understand; it blocks
  the import and shows the line.
- The result is validated with `validate`; its issues become errors.

## 3. Import dialog

- Toolbar button **Import SQL** opens a dialog (native `<dialog>`): a text area
  to paste, and a file picker for `.sql` that fills the same text area (so the
  text can be reviewed first). Files over 2 MB are refused with a message.
- **Live preview**: counts of tables, columns, foreign keys, indexes and types;
  warnings with line; errors. The Import button is disabled with errors or with
  nothing to import.
- With a non-empty project, a **Replace / Add** choice. Replace asks for a
  second click (like Load example). Add renames conflicts (`_2`, `_3`…) and
  remaps foreign keys.
- Layout: Replace lays everything out with `layoutTables`; Add lays out only
  the new tables, in a block to the right of the existing ones, leaving theirs
  untouched, then fits the canvas.
- Store action `importSchema(imported, mode)` does the merge and renaming in a
  pure function (`lib/import/merge-schema.ts`).

## Testing

- Core unit: tokenizer (each literal form), parser per statement kind,
  warnings and errors with lines, model operations and validation.
- Core integration: **round-trip** (`generateDdl` → `importSql` → same schema
  modulo ids) and a corpus of `pg_dump`-style scripts with the expected tables
  and warnings.
- Web unit: `merge-schema` (renaming, FK remapping, positions), store action,
  tooltip and icon components, `parseProject` filling defaults.
- e2e: paste, file upload (`setInputFiles`), preview content, Replace and Add,
  comment tooltip on hover, Inspector editing of the new fields, DDL hover on
  index and comment statements.

## Out of scope

Partial or expression indexes (warned), `CHECK` constraints, composite foreign
keys, composite types, triggers and functions, other dialects, data
(`INSERT`/`COPY`). A trigger for `updated_at` stays unmodelled.

## Risks

- PostgreSQL syntax is wide: the parser covers a stated subset and reports the
  rest; the corpus test is where gaps are found.
- Adding to `ColumnType` touches every `switch` over it (dialect, Inspector,
  column-type helpers); the compiler's exhaustiveness checks are relied on.
