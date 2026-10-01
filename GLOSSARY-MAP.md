# Domain Docs Map

This repo is multi-context. Each context owns its own `GLOSSARY.md` and its own ADRs.

## Contexts

### `packages/core` — the domain model

The semantic database model: tables, columns, types, keys, relationships, dialects, and the SQL generator/parser. Contains no React and no canvas code; a violation of that is itself a bug worth an ADR.

- Glossary: `packages/core/GLOSSARY.md`
- ADRs: `packages/core/docs/adr/`
- Not created yet. `/domain-modeling` writes them when terms actually get resolved.

### `apps/web` — the canvas and UI

The visual projection of the domain model: node positions, viewport, selection, toolbar, inspector, and the project shell. Consumes `packages/core`; must never be imported from it.

- Glossary: `apps/web/GLOSSARY.md`
- ADRs: `apps/web/docs/adr/`
- Not created yet. `/domain-modeling` writes them when terms actually get resolved.

## System-wide decisions

Cross-cutting decisions live in `docs/adr/` at the repo root: language and tooling choices, monorepo layout, persistence strategy, and anything both contexts must agree on.

## Vocabulary boundary

The term `Table` is the one that most needs care. In `packages/core` it is a database table — an entity with columns and constraints. In `apps/web` it is rendered as a **table node**: a positioned, sized box that *references* a table by id and holds no schema data of its own. If those two meanings are used interchangeably anywhere, the canvas is leaking into the model.