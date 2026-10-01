# Columns hold a logical type; the dialect maps it to a database type

A column's type is a logical one from a curated set (`integer`, `bigint`, `text`, `boolean`, `uuid`, `timestamp`, `date`, `json`, `varchar(n)`, `numeric(p,s)`), and a `Dialect` translates it to the database's own type. The PostgreSQL dialect maps `timestamp` to `timestamptz` and `json` to `jsonb`; the rest map one to one.

The alternatives were storing a PostgreSQL type directly, and storing free text. Either would tie every saved project to PostgreSQL, so adding a second dialect would mean migrating saved data. With a logical type, a new dialect is one new mapping.

## Consequences

**The set is deliberately small.** A database type that is not in the set cannot be used until the set grows; that is a feature of the slice, not a gap to patch with free text.

**`timestamp` means an instant.** It becomes `timestamptz`, the safe PostgreSQL choice; a future dialect decides its own spelling.

**Foreign keys compare kinds, not parameters.** Two `varchar` columns of different lengths are compatible; `integer` and `bigint` are not.

**The type limits are the PostgreSQL ones** (`varchar` up to 10485760, `numeric` precision up to 1000), exported from the core so the parser and the editing UI share them.
