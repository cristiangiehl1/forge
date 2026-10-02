# 0007. Indexes, comments, defaults and user types in the model

Status: accepted

## Context

Importing a SQL script needs somewhere to put what it reads. A script has indexes, `COMMENT ON`, arbitrary `DEFAULT` expressions, enums and domains, and more column types than the model had. Reading and discarding them would make the import lossy and the generated DDL would not match what was pasted.

## Decision

- New data is **optional** on the existing immutable types (`Table.indexes?`, `Table.comment?`, `Column.comment?`, `Column.default?`, `Schema.types?`). Absent means empty, as `Column.generated?` already does, so projects saved earlier stay valid, `formatVersion` stays 1, and no existing literal had to change.
- `Index` has a name, the columns in order, `unique` and a method (`btree`, `hash`, `gin`, `gist`). Partial, expression and `INCLUDE` indexes are not modelled.
- `Column.default` is a raw SQL expression, written as is; it excludes `generated` (a validation issue). An empty string means none.
- `UserType` is an enum or a simple domain (a `CHECK` is not modelled). A column refers to one with `{ kind: 'user', typeId }`; arrays are `{ kind: 'array', of }`. A type that is in use cannot be removed.
- New native kinds: `smallint`, `real`, `double`, `time`, `timestamp_no_tz` (the existing `timestamp` stays `timestamptz`), `interval`, `bytea`, and `char(n)`. There is no `jsonb` kind (`json` already maps to `jsonb`) and no `serial` kind (it is `integer` + `generated`).
- A foreign key compares the shape of the types (the kind, the element of an array, the id of a user type), not only the kind.
- DDL order: types (enums, then domains after the types they use), tables (existing foreign-key order), deferred foreign keys, indexes, comments. `DdlStatement` gains the kinds `type`, `index` and `comment`; only `type` has no `tableId`.
- `generated` may also be set on a `timestamp`, which the PostgreSQL dialect writes as `DEFAULT now()` (amends ADR-0005).

## Consequences

- Code that reads `statement.tableId` must narrow (`'tableId' in statement`).
- `CHECK`, composite types, partial and expression indexes stay out until the model needs them; the SQL parser reports them as warnings.
