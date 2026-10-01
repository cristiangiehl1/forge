# React Flow for the canvas, with the React Compiler and the attribution link kept

The canvas in `apps/web` is built on React Flow (`@xyflow/react`). A table node is a React component rendered by React Flow, carrying only a table id in `node.data` and no schema data, which is the boundary the glossary map draws between `packages/core` and `apps/web`. React Flow's own vocabulary (node, edge, viewport, selection) matches the web glossary's terms.

The alternatives were weighed against current documentation (Context7), except Konva, which was judged from prior knowledge and not checked. tldraw was rejected because its SDK needs a license key to run in production (commercial use requires a commercial license) and it is a free-form whiteboard, not a structured node-and-edge editor. Konva was rejected because selection, column-to-column connections, and inline text editing would all have to be built by hand on an imperative 2D canvas. Excalidraw, JointJS, and AntV X6 were rejected on fit and licensing; a hand-built D3 canvas costs more than the product's canvas justifies.

## Consequences

**One handle per column.** Each column row in a table node renders its own `<Handle>` with a unique `id`, and an edge targets a column through `sourceHandle` and `targetHandle`. Adding or removing a column changes the handles, so the node must call `useUpdateNodeInternals(nodeId)` afterwards. Without it, React Flow does not recompute handle positions. This is unrelated to memoization and is always required.

**The attribution link stays visible.** React Flow is MIT-licensed but shows a small attribution link by default, and its policy requires either keeping it or subscribing to React Flow Pro to remove it. We keep it. Do not set `proOptions.hideAttribution` without reopening this decision.

**The React Compiler is on in `apps/web`, and memoization is not written by hand.** The compiler memoizes values, functions, and components, so `useMemo`, `useCallback`, and `React.memo` are not used, including for `nodeTypes`, `edgeTypes`, and node components, where React Flow's documentation still recommends them because it predates the compiler. The compiler only covers our code; React Flow's internals are the library's own. The project uses the latest version of every library, so there is no older-React support to consider.

**Reference stability comes from the store, not the compiler.** The compiler cannot prevent a `node.data` object from changing identity if the store rebuilds it on every update. Updates to the canvas state must be immutable and touch only what changed, so unchanged nodes keep their references.

**State lives in an external store.** React Flow's guidance is a central store once the app grows, instead of passing functions through `node.data`. The store holds the `@forge/core` model plus the visual projection (positions, viewport, selection). The choice of store library is a separate decision.

**Revisit if** the canvas must handle a node count or rendering load that DOM-based nodes cannot sustain, at which point an imperative canvas such as Konva would be reconsidered.
