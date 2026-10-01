# What a new table starts with is an app preference, kept apart from the project

A new table can start with a generated `id` column (integer, the default, or uuid) or with nothing. That choice is an app setting, `newTableId`, stored under its own key (`forge:settings`) and read before the first render. It is not part of the saved project.

It was kept out of the project because it describes how the user likes to work, not what the schema is: it should apply to every project and survive "Start a new project", and the project file stays exactly the document the core validates. The store loads it with `loadSettings` and saves it with a subscription the moment it changes.

## Consequences

**It never fails the app.** `loadSettings` falls back to the default for a missing, unreadable, malformed or blocked value, and `saveSettings` swallows a failed write. A lost preference is not worth an error.

**No TanStack Query hook.** ADR-0004 puts loading and saving the project behind query hooks so the storage can move to an API. The settings are a tiny synchronous value that stays on the device, so they are read and written directly by the store module.

**Only new tables are affected.** Changing the choice never touches a table that exists.

**The Playwright suite opens the app with the preference on `none`**, since its tests build their own columns; the tests for this feature, and the guided tour, opt in explicitly.
