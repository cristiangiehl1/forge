# The saved project is an envelope with an opaque `view`

A saved project is `{ formatVersion, schema, view }`. The core owns the envelope, its version number and the validation of `schema` (`parseProject`); `view` is JSON that the core carries without reading. The web puts node positions and the viewport there.

Positions and viewport belong to the canvas, whose vocabulary (node, viewport, selection) is the web's, not the core's. Putting them in `Schema` would leak the canvas into the model. Putting the whole format in the web would move versioning and validation of the model out of the one place that can test them. The opaque slot keeps both boundaries.

## Consequences

**A project with Issues is still a valid file.** `parseProject` rejects only a document it cannot interpret: wrong shape, an unknown `formatVersion`, duplicate ids, or a reference to something that does not exist (a relationship pointing at a deleted table). Empty names and type mismatches are the user's draft, reported by `validate`.

**A newer file is refused, not guessed at.** A `formatVersion` this app does not know is an error with a clear message; the stored data is never rewritten on a failed load.

**The `view` is cosmetic.** The web validates it on its own and replaces a malformed one with defaults instead of failing the load.
