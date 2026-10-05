# 0011. Types per database, read and written

Status: accepted

## Context

The types are the core of the project: the engine must know what each relational database calls them, in both directions. Importing the team's Oracle migrations (`NUMBER` for ids and coordinates, `NUMBER(1)` with a `CHECK` for booleans, `CLOB` with `IS JSON`) exposed that the model only had PostgreSQL's view of types and that a type it did not know became a silent `text`.

## Decision

- **Two new column types.** `number` is a number with no precision (`NUMBER` in Oracle, `numeric` in PostgreSQL) and may be generated. `native` (`{ dialect, text }`) keeps what the model has no logical type for, as its database writes it. In its own database it is written as it came; in another it becomes a safe type (`text`, `CLOB`) with a compatibility note.
- **A dialect owns writing and reading.** Writing is `typeName`/`resolveType`; reading is one module per database (`sql/parse/types/<dialect>.ts`) behind `parseColumnType`. A new database is a writer and a type reader.
- **Names are folded by the dialect.** A plain name is lower case in PostgreSQL and upper case in Oracle; a quoted name keeps its case. Names read from Oracle stay upper case, as in the database; PostgreSQL DDL from such a model writes them quoted.
- **A `CHECK` can say what a column is, and nothing more is inferred.** `c IN (0,1)` makes a whole-number column `boolean`, `c IS JSON` makes a text column `json`. An enum written as `IN ('A','B')` stays `varchar` with a warning.
- **`NUMBER(p)` is read by precision** (`smallint` up to 4 digits, `integer` up to 9, `bigint` up to 18, else `numeric(p,0)`); `NUMBER` alone is `number`.
- **An unknown type is `native`**, never a silent `text`. PostgreSQL `numeric` with no precision is now `number`.
- **A generated `number` is written `bigint` in PostgreSQL**, with a note, because identity exists only on integer types.
- **`importSql(sql, newId, dialect)`** reads the script as the chosen database; the Import dialog has a "Read as" choice that starts at the project's dialect.
- **The recruitment example** is read by the importer from a generated copy of the DDL migrations (`scripts/build-recruitment-example.mjs`), and loading it makes the project Oracle.

## Rejected

Reading every `NUMBER` as `bigint` or `numeric` (wrong for coordinates and wrong in the other direction); inferring enums from `IN ('A','B')`; converting the migrations by hand into the example.

## Consequences

- Reading and writing integer sizes is not an exact round trip: the writer gives `smallint`/`integer`/`bigint` the precisions 5/10/19, and reading by precision brings them back one size up.
- `native` data does not travel between databases; the notes say so.
- PL/SQL blocks, `ON DELETE` actions, `DESC` and expression indexes and general `CHECK`s are warned, not modelled.
