# `apps/web` tests: unit and integration only, centralized in `src/tests/`, on node:test

`apps/web` has automated tests, limited to two kinds: **unit** tests (one isolated, pure piece of code) and **integration** tests (several non-visual pieces working together, such as a `queries/` hook over the `lib/storage/` adapter). There are no component-rendering tests and no end-to-end tests. Tests are centralized under `src/tests/{unit,integration}`, following the folder-structure standard's test layout, and run with Node's native runner (`node:test` + `node:assert`, via `node --test`). Vitest, Jest, Testing Library, and Playwright are not used.

This deliberately departs from the standard's frontend rule (colocated `<file>.test.ts`): the web app uses the same centralized layout the standard prescribes for backends.

## Layout

```
src/tests/
├── unit/
│   └── lib/storage/local-storage.test.ts          # mirrors src/lib/storage/local-storage.ts
└── integration/
    └── project/
        ├── load.test.ts                           # queries/project/use-load-project.ts
        └── save.test.ts                           # queries/project/use-save-project.ts
```

- **`unit/`** mirrors the `src/` path of the isolated function under test. Named `<file>.test.ts`.
- **`integration/<name>/`** has one folder per domain, with the same name as `queries/<name>`. Files are named after the action tested (`load.test.ts`, `save.test.ts`). They exercise the real modules beneath the entry point (hook → storage adapter), replacing only the outermost boundary (e.g. `localStorage`).
- **`e2e/`** is not created.

## Consequences

**Only non-visual code is tested.** `queries/`, `lib/`, `hooks/` (when they don't need a DOM), and `schemas/` are in scope. Components under `components/` are not tested by rendering them. That would need a DOM and a rendering library, which this decision excludes. Anything in a component that deserves a test should be extracted into `lib/` or `hooks/` first.

**Rules still belong in `@forge/core`.** The web app stays a thin projection of the model. Schema rules, type mapping, DDL output, and the saved-project format are tested in `@forge/core`, not re-tested here. Web tests cover the web's own logic: persistence adapter behaviour, query/mutation wiring, canvas interaction math (selection, viewport, snapping).

**Test files are `.ts`.** Because rendering is out of scope, test files never need JSX. Running `.ts` directly under `node --test` relies on Node's native type-stripping. The Node version is pinned to the latest LTS in `mise.toml` and in `engines` at the repo root.

**Revisit if** a regression class appears that only a rendered component or a real browser would catch. That would reopen the exclusion of component and end-to-end tests.
