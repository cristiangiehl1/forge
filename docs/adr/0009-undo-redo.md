# 0009. Undo and redo with snapshots of the schema and the positions

Status: accepted

## Context

A visual editor needs to take edits back: an accidental drag, a deleted column, a replaced project. The schema and the view are immutable, so a past state is just a reference.

## Decision

- The history is a list of **snapshots** (`{ schema, nodes }`) in a pure module, `lib/history/`: record, group, limit to 100 steps, undo, redo. Snapshots share structure, so they are cheap. The zoom, the selection, hover and the app preferences are not part of it.
- Every store action that changes the schema or the positions goes through one function, `edit(key, change, fit?)`, which records the state before the change. A change that leaves both the schema and the positions as they were (by reference) is not a step.
- **Grouping:** a step has an optional key naming its target (`rename:<table>`, `column:<table>:<column>:<fields>`, `comment:<table>`, `index:…`, `type:<id>`, `move:<table>`). An edit with the same key as the last one, less than a second after it, joins the last step, so typing a name or dragging a table is one step. Every other action has no key and is its own step.
- **Project-level steps** (load example, import) are marked `fit`: undoing or redoing them asks the canvas to fit, because tables may be off screen. Other steps leave the viewport alone, and no step rebuilds the canvas (the project epoch does not move).
- The history lives **in memory only** and is reset when the saved project is loaded or a new project starts. It is never saved, so the project format did not change.
- **Keys:** Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo. They act everywhere, the Inspector's fields included (the store controls them, so the browser's own undo would put them out of step), except inside a `<dialog>`, whose text is local and uses the browser's undo.

## Rejected

- **Commands with inverse operations:** one inverse per operation, easy to get wrong, and every new operation needs another.
- **Saving the history in `localStorage`:** heavy (every step is a schema) and it would tie the saved format to the history.

## Consequences

- A new action that changes the schema or the positions must use `edit`, or it is not undoable.
- Creating a table and renaming it are two steps; so are removing a column and then changing another.
- The history is lost on reload.
