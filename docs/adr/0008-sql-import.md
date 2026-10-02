# 0008. Importing SQL: three layers and one dialog

Status: accepted

## Context

The app has to build a diagram from a PostgreSQL script that the user pastes or loads from a `.sql` file, and has to do it safely for a project that already has tables.

## Decision

- The feature is three layers, built in this order: the model (`packages/core`, [ADR-0007 of the core](../../packages/core/docs/adr/0007-indexes-comments-defaults-and-user-types.md): indexes, comments, defaults, enums, domains and the new column types), the parser (`importSql` in `packages/core`, [ADR-0008 of the core](../../packages/core/docs/adr/0008-sql-import-parser.md)) and the dialog (`apps/web`).
- The dialog parses the text when it changes and keeps the result in state; the schema that was previewed is the one that is imported, never a second parse. Errors disable Import, warnings do not.
- The toolbar's **Import SQL** opens a native `<dialog>`: a text area, a file picker (files over 1 MB are refused), a preview (counts, errors and skipped statements with their line, capped at 100 each) and, when the project has tables, **Add** (the default) or **Replace**.
- **Replace** swaps the whole project, lays everything out by relationships and resets the canvas; it needs a second click, like Load example. On an empty project an import is always a replace (which also clears a "could not be read" notice).
- **Add** appends. A table, index or type name already taken is renamed with `_2`, `_3`… (relationships point at ids, so they survive). Only the new tables are positioned, as a block to the right of what is drawn, level with its top; existing tables, the viewport and the project epoch are left alone, and the canvas is asked to fit.
- No drag and drop of files in this version; renames are silent and visible as the new names in the diagram.

## Consequences

- A large script is parsed on the main thread on every change; a web worker is the next step if that ever matters.
- Import is one more way to change the project, so it is saved by the same autosave as any edit.
