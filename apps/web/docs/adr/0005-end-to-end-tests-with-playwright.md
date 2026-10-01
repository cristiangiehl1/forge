# End-to-end tests with Playwright, in their own package

End-to-end tests run in a real browser with Playwright, in a separate workspace package, `apps/e2e` (`@forge/e2e`). They drive the app the way a person does, and double as a guided tour of what the system does today (`pnpm e2e:tour`, `pnpm e2e:ui`).

This amends ADR-0001 of the web app, which excluded Playwright and end-to-end tests and said to reopen that "if a regression class appears that only a rendered component or a real browser would catch". One did: with a table selected, React Flow's Backspace deleted every relationship touching it, silently. Nothing that runs under Node can see that; it only exists as the interaction of a key press, the canvas and the store. The request to watch the system run is the second reason.

## Consequences

**ADR-0001 still holds for the web package itself.** Unit and integration tests stay in `apps/web/src/tests`, on `node:test`, with no component rendering. The end-to-end suite does not replace them and does not test domain rules, which belong to `@forge/core`.

**The runner is Playwright's own** (`@playwright/test`), only inside `apps/e2e`. The rule against Vitest, Jest and Mocha is about unit tests and is untouched.

**It is not part of `pnpm test`.** Scripts are `pnpm e2e`, `pnpm e2e:ui`, `pnpm e2e:tour` and `pnpm e2e:report`, so the fast loop stays fast and does not need a browser.

**Tests use what a person can see.** Roles, labels and visible text, through an `Editor` helper (`support/editor.ts`). The app's markup is not changed to make it testable; a locator that needs a class name is a smell worth looking at.

**Every test keeps a trace, a video and a screenshot.** The suite exists to be watched. Output goes to `test-results/`, `playwright-report/` and `apps/e2e/screenshots/`, all ignored by git.

**It needs a browser.** `playwright install chromium` once per machine. No CI job exists yet.
