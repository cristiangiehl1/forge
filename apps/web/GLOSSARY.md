# Glossary: `apps/web`

The vocabulary of the canvas and the UI. The domain terms (Schema, Table, Column, Relationship) are defined in `packages/core/GLOSSARY.md` and used here as they are.

**Table node**: the box on the canvas that shows one Table. It references the Table by id and holds no schema data; its name, columns and types are read from the store. Avoid "table" for the box.

**Node**: anything positioned on the canvas. Today every Node is a table node.

**Viewport**: the pan and zoom of the canvas (`x`, `y`, `zoom`), saved with the project.

**Selection**: the Table currently chosen, shown in the Inspector; at most one, or none. A Relationship can be selected instead by clicking its line, which shows a button to remove it; selecting a Table and selecting a Relationship exclude each other.

**Inspector**: the side panel that edits the selected Table: its name and its columns. The table node itself is read-only.

**Toolbar**: the strip with the project-level actions: new table, the "New tables start with" preference, load example, auto-arrange, show or hide the DDL.

**DDL panel**: the panel that shows the PostgreSQL DDL generated from the Schema, or the list of Issues that prevent it.

**View**: what the web stores in the opaque `view` of a saved Project: node positions and the Viewport. It is cosmetic: a malformed one is replaced by defaults.

**Example project**: a ready-made online shop (seven tables, eight foreign keys) that the toolbar's "Load example" puts in place of the current project, so the system can be looked at with data in it. It is built with the core's own operations and has no special status once loaded: it is saved and edited like any project.

**Persistence mode**: `ready` (changes are autosaved) or `blocked` (the stored project could not be read, so nothing is saved until the user starts a new project).

**New-table id preference**: the app setting "New tables start with": `integer` (a generated integer `id`, the default), `uuid` (a generated uuid `id`) or `none`. It only affects tables created afterwards, belongs to the app and not to a project, and is kept under its own storage key.

**New-table timestamps preference**: the app setting "created_at / updated_at on new tables" (off by default). When on, a new table also gets two generated, required `timestamp` columns, `created_at` and `updated_at`, which the DDL writes as `timestamptz NOT NULL DEFAULT now()`. `updated_at` is only filled on insert: refreshing it on update would need a trigger, which Forge does not model. It is stored with the other app settings, each field falling back on its own.

**Node geometry**: the fixed size of a table node (220 px wide, a 31 px title, 26 px per column row, 1 px border), pinned in both `lib/geometry.ts` and the CSS. Layout and routing rely on it to know where every table and connection point is without measuring the page.

**Layout**: `layoutTables` places tables in layers by their relationships: a table referenced by another sits to its left, siblings are ordered to keep lines short, and unrelated tables go to the side. The toolbar's "Auto-arrange" applies it; the example is laid out with it.

**Route**: the orthogonal polyline of a Relationship, worked out by `routeRelationships` so it goes round every table. Each column row has a connection point on both sides of its table; the route picks the sides, and the edge draws exactly those points.

**Hover**: the Table under the pointer, or whose statement in the DDL panel is under the pointer. It highlights the node, its Relationship lines and its statement (the rest of the script dims).
