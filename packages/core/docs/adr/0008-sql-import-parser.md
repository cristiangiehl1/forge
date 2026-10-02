# 0008. A hand-written SQL parser in the core

Status: accepted

## Context

The app must create tables and relationships from a pasted or loaded PostgreSQL script (`importSql`). The model already holds indexes, comments, defaults, enums and domains (ADR-0007), so nothing the script says has to be thrown away for lack of a place to put it.

## Decision

- The parser is written by hand in `@forge/core`, with no dependency: a tokenizer (lines, source offsets) → a statement splitter → one small recursive-descent parser per statement kind, producing plain "raw" records → a builder that assigns ids, resolves names, applies Forge's own rules and validates.
- The builder reuses `checkRelationship` and `validate`; it does not copy their rules. A foreign key Forge would refuse is dropped with a warning that gives the reason.
- Unquoted names fold to lower case, quoted names keep their case, as in PostgreSQL.
- **Warnings** are for valid SQL that Forge does not model (with its line); **errors** are for a statement it should understand but cannot, or for a result that fails `validate`. A broken statement does not stop the others; a script cut off by an unterminated string or comment reports one error and imports what came before.
- Statements read: `CREATE TABLE`, `ALTER TABLE … ADD CONSTRAINT` (primary key, unique, foreign key), `ALTER COLUMN … SET DEFAULT` and `ADD GENERATED … AS IDENTITY` (how `pg_dump` writes a serial), `CREATE [UNIQUE] INDEX`, `CREATE TYPE … AS ENUM`, `CREATE DOMAIN`, `COMMENT ON TABLE/COLUMN`. `COPY … FROM stdin` data and psql meta-commands are skipped by the tokenizer.
- Defaults that PostgreSQL itself generates (`serial`, identity, `nextval`, `now()` on a `timestamptz`, `gen_random_uuid()`) become `generated`; any other default stays raw.
- What Forge writes reads back to the same schema (a round-trip test), and a `pg_dump`-style corpus test guards real scripts.

## Rejected

A PostgreSQL parser library (for instance one compiled to WASM): it covers the whole grammar, but it is heavy, reports positions in bytes rather than lines, needs its tree mapped to Forge's model anyway, and breaks "the core has no dependencies".

## Consequences

- The supported subset is stated here and in the glossary; gaps are found with the corpus test.
- `CHECK` constraints, partial and expression indexes, composite foreign keys, composite types, triggers, functions and views stay warnings.
- Constructs the model cannot hold (`time with time zone`, a generated expression, an unconstrained `numeric`, a `smallint` identity) are imported in the nearest form that stays valid, with a warning.
