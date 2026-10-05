# Reading Oracle SQL, and a type system that knows each database

Status: approved in conversation, awaiting written-spec review.

## Intent

The engine knows the types of every relational database it supports, **in both directions**: it writes them (model → SQL) and it reads them (SQL → model). Importing the team's Oracle migrations (`sistema-recrutamento-selecao`) must give a faithful model, and generating Oracle DDL from it must give back what was read. The types are the core of the project, so they are a layer of their own, not special cases.

Decisions taken with the user:

1. **`NUMBER` stays `NUMBER`.** The model gets a logical type `number` (a number with no precision): `NUMBER` in Oracle, `numeric` in PostgreSQL. PostgreSQL's `numeric` with no precision is read as `number` too (it used to be `numeric(38,10)` with a warning).
2. **What has no logical type is kept native.** A column type `native` (`{ dialect, text }`) holds what the model does not know yet (`NVARCHAR2(100)`, `NCLOB`, `ROWID`, `XMLTYPE`, `INTERVAL YEAR TO MONTH` in Oracle; `money`, `inet`, `xml` in PostgreSQL). In its own database it is written as it came; in another it becomes a safe type (`text` in PostgreSQL, `CLOB` in Oracle) with a compatibility note. A type name that is not an enum or domain of the script is native, not a silent `text`.
3. **Names read from Oracle are UPPER CASE** in the diagram (`KONTRATA_JOBS`, `SENIOR_CARGO_CODE`), as they are in the database; a quoted name keeps its exact case. How a plain name is folded is a property of the dialect (PostgreSQL folds to lower case, Oracle to upper case), and each reader follows the rule of its database. Generating Oracle DDL writes plain upper-case names unquoted, so the round trip is exact; generating PostgreSQL DDL from such a model writes them quoted (`"KONTRATA_JOBS"`), because PostgreSQL would fold an unquoted one to lower case.
4. **The dialect of the script is chosen in the import dialog** ("Read as": PostgreSQL | Oracle), starting at the project's dialect.
5. **The example is the recruitment system:** a copy of the DDL migrations is bundled and read by the Oracle importer; loading it switches the project to Oracle.

## Types, both ways

| Oracle (read) | Model |
|---|---|
| `VARCHAR2(n [BYTE\|CHAR])`, `CHAR(n [BYTE\|CHAR])` | `varchar(n)`, `char(n)` |
| `CLOB` / `BLOB` | `text` / `bytea` |
| `RAW(16)` / other `RAW(n)` | `uuid` / `bytea` |
| `NUMBER` | `number` |
| `NUMBER(p)` and `NUMBER(p,0)` | `smallint` (p ≤ 4), `integer` (p ≤ 9), `bigint` (p ≤ 18), else `numeric(p,0)` |
| `NUMBER(p,s)`, s > 0 | `numeric(p,s)` |
| `NUMBER(1)` with `CHECK (c IN (0,1))` | `boolean` |
| `CLOB` (or any text) with `CHECK (c IS JSON)` | `json` |
| `FLOAT[(p)]` / `BINARY_FLOAT` / `BINARY_DOUBLE` | `double` / `real` / `double` |
| `DATE` | `date` |
| `TIMESTAMP[(p)]` | `timestamp` without zone |
| `TIMESTAMP[(p)] WITH TIME ZONE` | `timestamp` (an instant) |
| `INTERVAL DAY[(p)] TO SECOND[(s)]` | `interval` |
| `NVARCHAR2`, `NCHAR`, `NCLOB`, `LONG`, `ROWID`, `UROWID`, `XMLTYPE`, `INTERVAL YEAR TO MONTH`, `TIMESTAMP WITH LOCAL TIME ZONE`, anything else | `native` (oracle) |

Writing is as for the Oracle dialect, plus `number` → `NUMBER` and `native` as above. For PostgreSQL, `number` is `numeric`; a generated `number` (identity) is written `bigint` with a note, since PostgreSQL has identity only on integers.

## What the Oracle reader understands

- `CREATE TABLE`: columns with `[NOT] NULL`, `DEFAULT expr`, `GENERATED {ALWAYS | BY DEFAULT} [ON NULL] AS IDENTITY [(…)]`, inline `CHECK`, `[CONSTRAINT n] PRIMARY KEY | UNIQUE | REFERENCES t [(c)] [ON DELETE CASCADE | SET NULL]`; table constraints `PRIMARY KEY`, `UNIQUE`, `FOREIGN KEY`, `CHECK`; trailing physical clauses (`TABLESPACE`, `PCTFREE`, …) are warned and ignored; the `ENABLE`/`DISABLE`/`VALIDATE`/`NOVALIDATE` words after a constraint are skipped.
- `CHECK`: `c IN (0,1)` and `c IS JSON` change the column's type (as above); any other `CHECK` is a warning (it is not modelled; an enum written as `IN ('A','B')` stays a `varchar`).
- `ALTER TABLE … ADD CONSTRAINT`, `CREATE [UNIQUE] INDEX` (an index with `DESC` or an expression is a warning and is skipped), `COMMENT ON TABLE/COLUMN`; `CREATE SEQUENCE`, `CREATE TRIGGER`, `INSERT`, PL/SQL blocks and the `/` terminator line are skipped with a warning (the `/` silently).
- Generated: identity; `DEFAULT SYS_GUID()` on a `RAW(16)`; `DEFAULT SYSTIMESTAMP` or `CURRENT_TIMESTAMP` on `TIMESTAMP WITH TIME ZONE`. Other defaults stay raw. A boolean's `1`/`0` default is kept as `true`/`false`.
- A foreign key action is a warning (the model has none), as in PostgreSQL.

## Core

- `ColumnType` gains `{ kind: 'number' }` (a simple kind) and `{ kind: 'native'; dialect: DialectId; text: string }`. `number` may be generated. Validation: a native `text` is not blank; two native types are the same shape when dialect and text are (case-insensitive).
- `parseProject` reads both; the dialect writers (`typeName`, `resolveType`) handle both.
- `Cursor` carries the script's `dialect`; `identifier()` folds a plain word by that dialect (lower for PostgreSQL, upper for Oracle); `parseColumnType` dispatches to `types/postgres.ts` or `types/oracle.ts`. `tokenize(sql, dialect)` skips a line that is only `/` in Oracle. `importSql(sql, newId, dialect = 'postgres')`.
- The builder resolves hints from `CHECK`s and the Oracle defaults; an unknown named type becomes `native` for the script's dialect.

## Web

- The type selector offers `number`; a `native` column shows its text, which can be edited in a field next to the selector; every canvas and DDL place formats both types.
- The import dialog has **Read as** (PostgreSQL | Oracle), set to the project's dialect when it opens; its note about PostgreSQL goes away.
- A second **Load recruitment example** button loads the bundled Oracle migrations through the importer and sets the project's dialect to Oracle (asking for the second click, like the first example).

## Testing

Unit: each type mapping both ways, the reader on excerpts of the real migrations, `CHECK` hints, identity and defaults, native types across dialects, `number` and native in `parseProject`; the bundled example imports with no errors and the expected table count; generating Oracle DDL from it and reading that again gives the same schema (round trip). e2e: the example loads and is laid out, `number` and a native column in the Inspector, the "Read as" select, an Oracle script imported into a PostgreSQL project.

## Out of scope

SQL Server and MySQL (the layer is made for them); PL/SQL bodies; enum inference from `IN ('A','B')`; `ON DELETE` actions in the model; Oracle partitioning, tablespaces and storage clauses; translating a PostgreSQL-only default into Oracle and the reverse beyond what exists.
