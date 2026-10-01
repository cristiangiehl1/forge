# TanStack Query wraps the persistence functions

Loading and saving the project go through TanStack Query hooks in `queries/project/` (`useLoadProject`, `useSaveProject`), as the folder standard prescribes for every call to the persistence layer. The hooks are thin wrappers around plain functions, `loadProject(storage)` and `saveProject(storage, project)`, which hold the actual logic.

`localStorage` is synchronous, so TanStack Query adds nothing today. It is adopted now so that moving to `apps/api` later means writing a new storage adapter and nothing else: the components, the hooks and their call sites stay as they are, which is the intent of ADR-0003 (persistence goes through `queries/project/`). Plain hooks would work today and need rewriting when the API arrives.

## Consequences

**The logic lives outside the hooks.** `loadProject` and `saveProject` take a storage and return a result (`LoadResult`, `SaveResult`); they never throw. The tests exercise them directly under Node, with no rendering, which the testing ADR requires.

**The hooks are not tested.** They hold no logic: the query function, the mutation function and their options.

**Autosave is a component concern, not a query one.** `useAutosave` decides when to call the mutation (500 ms after the last change, and on `pagehide`), and does nothing while persistence is blocked.
