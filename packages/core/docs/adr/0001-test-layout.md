# `@forge/core` tests: unit and integration, centralized in `src/tests/`, on node:test

`@forge/core` is tested with Node's native runner (`node:test` + `node:assert`, via `node --test`), with the same layout as `apps/web`: centralized under `src/tests/{unit,integration}`, following the folder-structure standard's test layout. Vitest, Jest, and Mocha are not used. There is no `e2e/` folder.

## Layout

```
src/tests/
├── unit/
│   └── sql/generate/postgres/create-table.test.ts   # mirrors src/sql/generate/postgres/create-table.ts
└── integration/
    └── sql/
        └── round-trip.test.ts                       # parse → schema → generate
```

- **`unit/`** mirrors the `src/` path of the isolated pure function under test. Named `<file>.test.ts`.
- **`integration/<name>/`** has one folder per area, named like the `src/` folder it exercises (`sql/`, `project/`). Files are named after the flow tested (`round-trip.test.ts`, `load.test.ts`). They run several real modules together with nothing faked: no HTTP and no I/O exist in this package, so there is no boundary to replace.

## Consequences

**Everything here is pure.** `@forge/core` has no I/O (ADR-0001, system-wide), so unit tests need no fakes and integration tests need no stubs. A test that wants a fake is a sign that platform code leaked into the package.

**Test files stay out of the public API.** `src/tests/` is not exported from `index.ts` and is excluded from the package build.

**Running `.ts` directly under `node --test`** relies on Node's native type-stripping. The Node version is pinned to the latest LTS in `mise.toml` and in `engines` at the repo root.

**Domain rules are tested here and nowhere else.** Schema rules, type mapping per dialect, DDL output, and the saved-project format (including versioning and validation) belong to this package's tests. `apps/web` does not re-test them (see `apps/web/docs/adr/0001-frontend-testing-scope.md`).
