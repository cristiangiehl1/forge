# The schema is immutable data edited by pure functions

`Schema` is a plain, JSON-serializable object, and every edit (`addTable`, `updateColumn`, `setPrimaryKey`, ...) is a pure function that returns a new `Schema`, sharing every part that did not change. Validation is a separate pure function, `validate`, that returns a list of issues instead of throwing.

The alternatives were classes with mutable methods, and commands with `apply`/`undo`. Mutable classes fight the web's store, which needs immutable updates to keep unchanged nodes referentially stable (ADR-0003 of the web app), and they need a separate step to serialize. Commands give undo/redo, but nothing in the first slice asks for it; history can be layered on later by keeping earlier snapshots, since a snapshot is just a `Schema`.

## Consequences

**Operations never throw and never mutate.** Called with an id that no longer exists (a UI acting on something just deleted), an operation returns the same `Schema` object it received.

**Invalid is a state, not an exception.** A Schema with empty names or incompatible types can be built, saved and reloaded; `validate` reports it and the DDL generator refuses it. The user can leave a draft half-finished.

**IDs come from the caller.** The core does not generate them, because that would need `crypto` or a counter, which breaks the platform-free rule of ADR-0001 or makes tests depend on hidden state.
