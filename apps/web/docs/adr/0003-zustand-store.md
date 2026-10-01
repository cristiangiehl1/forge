# Zustand for the web app's state

`apps/web` keeps its state in a Zustand store. The store holds the `@forge/core` model plus the visual projection of it (node positions, viewport, selection), and React Flow reads and writes through it. The canvas is controlled: React Flow only reports the changes it wants (`onNodesChange`, `onEdgesChange`) and the app forwards the ones it owns to store actions, in `lib/canvas/forward-changes.ts`. Only node moves, node and edge selection, and edge removals are forwarded; a node removal never is. Delete and Backspace remove a selected relationship, but `onBeforeDelete` (`lib/canvas/deletion-guard.ts`) refuses any deletion that includes a table, because React Flow would otherwise delete every relationship touching a selected table along with it, silently. A relationship is removed by clicking its line and using the button on it, with the Delete key, or from the inspector; a table is removed only from the inspector. This is the central-store approach React Flow's documentation recommends once an app grows, and its own examples use Zustand.

## Consequences

**The store is the only owner of canvas state.** Components read slices with selectors and call store actions. Nothing is passed through `node.data` except the table id (ADR-0002), and handlers are not threaded down as props.

**Updates are immutable and minimal.** An action replaces only the objects that changed, so unchanged nodes keep their identity. The React Compiler does not provide that stability (ADR-0002); the store has to.

**The model and the projection stay separate inside the store.** The `@forge/core` model (schema, tables, columns, relationships) and the canvas projection (node positions, viewport, selection) are distinct slices, because the first is domain data owned by `packages/core` and the second is a canvas concern owned by `apps/web`. A table node references a table by id and holds no schema data.

**Persistence goes through `lib/storage/`.** The store does not touch `localStorage` directly; saving and loading go through the `queries/project/` hooks and the storage adapter.

**Store logic is testable without React.** Zustand stores can be exercised as plain functions, so store actions are covered by unit and integration tests under `src/tests/` (see `0001-frontend-testing-scope.md`).
