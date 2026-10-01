# `@forge/e2e`: the system in a real browser

End-to-end tests with [Playwright](https://playwright.dev). They drive the real
`apps/web` app the way a person does (clicking, typing, dragging from one column
to another) and they are written to be **watched** as much as to catch bugs.

## See it

Run these from the repository root, with Node 24 (`mise`).

| Command | What you get |
|---|---|
| `pnpm e2e:tour` | Opens a browser window and plays the guided tour slowly: builds a shop with six tables and six foreign keys, selects and removes a relationship, shows the DDL, reloads the page. |
| `pnpm e2e:ui` | Playwright's UI mode: pick a test, step through every action, with a timeline and a snapshot at each step. The friendliest way to look around. |
| `pnpm e2e` | Runs every test headless (about 30 s) and writes the report. |
| `pnpm e2e:report` | Opens the HTML report of the last run: for each test a **video**, a **trace** and **screenshots**. |

The tour also saves a screenshot per step in `apps/e2e/screenshots/`
(`01-empty-editor.png` … `09-after-reload.png`).

The first time on a machine, install the browser once:
`pnpm --filter @forge/e2e exec playwright install chromium`.

## What is covered

| File | What it checks |
|---|---|
| `tests/tour.spec.ts` | The guided tour. Also asserts the six-table shop and its DDL end to end. |
| `tests/editing.spec.ts` | New tables, every column type, varchar and numeric parameters, primary keys, deleting tables and columns. |
| `tests/relationships.spec.ts` | Creating relationships by dragging, the refusals (same source column, different types, target not a primary key), selecting a relationship by clicking its line, removing it (button, Delete key, inspector), and that Backspace with a table selected deletes nothing. |
| `tests/ddl.spec.ts` | The DDL panel: empty project, empty table, quoted names, invalid schema, the full shop. |
| `tests/persistence.spec.ts` | Reload restores everything, an unreadable or newer stored project is reported and left untouched, blocked browser storage. |

## How it is built

- `playwright.config.ts` starts the web app on port **5273** (so it never
  collides with `pnpm dev` on 5173) and keeps a trace, a video and a screenshot
  of every test. `SLOWMO=300` slows a headed run down.
- `support/editor.ts` is an `Editor` that speaks the app's language: `addTable`,
  `addColumn`, `connect`, `clickRelationship`, `ddl`. Tests read like the thing
  a person does, and only use what a person can see (roles, labels, text).
- `support/shop.ts` is the six-table shop, with the exact DDL it must produce.
- Every test runs in a fresh browser context, so storage never leaks between
  tests.

`pnpm test` does **not** run these: they need a browser and take longer.
