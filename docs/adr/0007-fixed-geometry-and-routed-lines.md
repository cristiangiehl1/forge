# 0007. Fixed table geometry, layered layout and routed lines

Status: accepted

## Context

Lines between tables ran behind tables: every column had one right-side source and one left-side target handle, so a line from child to parent wrapped around both nodes. Imported or loaded schemas also had no placement that respected parents and children.

## Decision

- A table node has a fixed size (width 220, title 31, rows 26, border 1), defined in `apps/web/src/lib/geometry.ts` and pinned in CSS. Layout and routing become pure functions of the schema and positions, testable without a browser.
- `layoutTables` arranges tables in layers (parents left of children) with barycenter ordering.
- `routeRelationships` finds, per relationship, an orthogonal path avoiding every table (A* on a grid of lanes with bend and margin costs) and chooses the side of each end. Every column has handles on both sides and the canvas uses `ConnectionMode.Loose`; the custom edge draws the computed points, ignoring React Flow's own endpoints.
- `generateDdl` also returns `statements` tagged with their table, which lets hover link a node and its SQL in both directions.

## Consequences

- Tables cannot grow with content: long names are ellipsized.
- Routing is recomputed when schema or positions change (not on hover or selection).
- A route with no free path falls back to a high-cost direct line.
