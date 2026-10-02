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

**Generated column**: a Column whose value the database produces: an identity for an `integer` or `bigint`, a default (`gen_random_uuid()`) for a `uuid`, `DEFAULT now()` for a `timestamp` (stored as `timestamptz`, so in UTC). It is a flag on the Column (`generated`), allowed only on those four types, and absent means false. Avoid "auto-increment" and "serial" in code and in the model; the toolbar says "auto-increment" to the user, because that is the familiar word.

**Index**: a named index on one table: its columns in order, `unique`, and a method (`btree`, `hash`, `gin`, `gist`). Partial and expression indexes are not modelled. Index names are unique across the whole Schema, as in PostgreSQL.

**User type**: an enum (a name and its values) or a domain (a name over a base type, optionally `NOT NULL` and with a default). Columns use one through `{ kind: 'user', typeId }`. A user type that is in use cannot be removed.

**Default**: a raw SQL expression on a Column, written into the DDL as it is. It excludes Generated; an empty string means none.

**Comment**: free text on a Table or a Column, written as `COMMENT ON`. Blank means none.
