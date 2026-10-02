# Undo and redo

Status: approved in conversation, awaiting written-spec review.

## Intent

The user can take back an edit and put it back again, with buttons and with the usual keys, without the canvas jumping around. An accidental drag, a deleted column or a replaced project is one step away from being undone.

Decisions taken with the user:

1. **What is in the history:** the `Schema` and the positions of the tables. Selection, hover, zoom/viewport, the app preferences and the canvas fit are not.
2. **Size of a step:** edits to the same field in a row (typing a name) are one step while the user pauses less than about one second; dragging a table is one step; every click on a button (add a column, remove, connect, import, load example, auto-arrange) is its own step.
3. **The history lives in memory only**, at most 100 steps. Reloading starts with an empty history; the project itself is saved as before and its format does not change.

## Model

- A **snapshot** is `{ schema, nodes }`. Both are immutable, so snapshots share structure and cost little.
- The **history** is `{ past, future, lastKey, lastAt }`: entries (`{ snapshot, fit }`) to undo to, entries to redo to, and the key and time of the last edit, used to group.
- Recording an edit pushes the state **before** it, unless the edit has the same key as the last one and happened less than one second after it (then it only moves `lastAt`). Every recorded edit empties `future`. `past` keeps the last 100 entries.
- Undo moves the last `past` entry into place and pushes the current state onto `future`; redo is the mirror. After either, `lastKey` is cleared, so the next edit is a new step.
- A step made by loading the example or importing a script (replace or add) is marked `fit`: undoing or redoing it asks the canvas to fit, because tables may be off screen. Other steps leave the viewport alone.
- Loading the saved project and starting a new project reset the history (a new document).

## Store

- Every action that changes the schema or the positions goes through one point, `edit(key, change, fit?)`, which records and applies. A change that leaves both the schema and the positions as they were is not a step.
- Grouping keys: `rename:<table>`, `column:<table>:<column>:<fields>`, `comment:<table>`, `index:<table>:<index>:<fields>`, `type:<type>`, `move:<table>`. Every other action has no key and never groups.
- `undo()` and `redo()` restore the schema and the positions, keep the viewport, clear a selection or hover that points at something that is gone, and do not change the project epoch (the canvas is not rebuilt).
- `ForgeStoreDeps` gains an optional `now: () => number` so tests control time.

## Screen

- Toolbar buttons **Undo** and **Redo**, disabled when there is nothing to undo or redo.
- Keys: Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. They work everywhere, including inside the Inspector's fields (which the store controls, so the browser's own undo would put them out of step), except inside a dialog, whose text is local and uses the browser's undo.

## Testing

- Unit: the pure history functions (record, group, limit, undo, redo); the store (each kind of action undoes and redoes, grouping with a controlled clock, a new edit after an undo empties redo, selection and hover cleared, viewport and epoch untouched, import and example are steps and ask for a fit, hydrate and new project reset); the shortcut mapping.
- e2e: add a table and undo/redo it; type a name and undo it in one step; drag a table and undo its position; the keys; the buttons' disabled state; undo after an import.

## Out of scope

Saving the history, undoing selection or zoom, a history list or panel, and undoing preference changes.
