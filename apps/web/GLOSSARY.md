# Glossary: `apps/web`

The vocabulary of the canvas and the UI. The domain terms (Schema, Table, Column, Relationship) are defined in `packages/core/GLOSSARY.md` and used here as they are.

**Table node**: the box on the canvas that shows one Table. It references the Table by id and holds no schema data; its name, columns and types are read from the store. Avoid "table" for the box.

**Node**: anything positioned on the canvas. Today every Node is a table node.

**Viewport**: the pan and zoom of the canvas (`x`, `y`, `zoom`), saved with the project.

**Selection**: the Table currently chosen, shown in the Inspector; at most one, or none. A Relationship can be selected instead by clicking its line, which shows a button to remove it; selecting a Table and selecting a Relationship exclude each other.

**Inspector**: the side panel that edits the selected Table: its name and its columns. The table node itself is read-only.

**Toolbar**: the strip with the project-level actions: new table, the "New tables start with" preference, show or hide the DDL.

**DDL panel**: the panel that shows the PostgreSQL DDL generated from the Schema, or the list of Issues that prevent it.

**View**: what the web stores in the opaque `view` of a saved Project: node positions and the Viewport. It is cosmetic: a malformed one is replaced by defaults.

**Persistence mode**: `ready` (changes are autosaved) or `blocked` (the stored project could not be read, so nothing is saved until the user starts a new project).

**New-table id preference**: the app setting "New tables start with": `integer` (a generated integer `id`, the default), `uuid` (a generated uuid `id`) or `none`. It only affects tables created afterwards, belongs to the app and not to a project, and is kept under its own storage key.
