import type { Schema, TableId } from '@forge/core'

import type { Point } from '../geometry.ts'
import { NODE_WIDTH, nodeHeight } from '../geometry.ts'

export interface LayoutOptions {
  origin?: Point
  /** Horizontal space between two layers: room for the lines to run in. */
  gapX?: number
  /** Vertical space between two tables of a layer. */
  gapY?: number
  /** Vertical space between two groups of unrelated tables. */
  componentGap?: number
  /** How many tables a row of the grid of unrelated tables holds. */
  looseColumns?: number
}

const snap = (value: number) => Math.round(value / 10) * 10

/**
 * Lays tables out in layers, left to right: a table sits to the right of every
 * table it references, so parents are on the left and their children, their
 * children's children and so on follow. Inside a layer the order is the one that
 * crosses the fewest lines (siblings end up together), and a table sits as close
 * to the middle of its neighbours as the tables around it allow.
 *
 * Groups of tables that are not related to each other are stacked, and tables
 * with no relationship at all go in a grid below. It is pure and deterministic,
 * and does not know about the canvas: it is what a SQL import will use too.
 */
export function layoutTables(
  schema: Schema,
  options: LayoutOptions = {}
): Record<TableId, Point> {
  const origin = options.origin ?? { x: 40, y: 40 }
  const gapX = options.gapX ?? 140
  const gapY = options.gapY ?? 50
  const componentGap = options.componentGap ?? 80
  const looseColumns = options.looseColumns ?? 3

  const index = new Map(schema.tables.map((table, i) => [table.id, i]))
  const height = new Map(
    schema.tables.map((table) => [table.id, nodeHeight(table.columns.length)])
  )

  // child -> parent edges: one per pair, a self reference does not count.
  const parentsOf = new Map<TableId, TableId[]>()
  const childrenOf = new Map<TableId, TableId[]>()
  const linked = new Set<TableId>()
  for (const relationship of schema.relationships) {
    const child = relationship.from.tableId
    const parent = relationship.to.tableId
    if (child === parent || !index.has(child) || !index.has(parent)) continue
    const parents = parentsOf.get(child) ?? []
    if (parents.includes(parent)) continue
    parentsOf.set(child, [...parents, parent])
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child])
    linked.add(child)
    linked.add(parent)
  }

  // Groups of related tables (connected components), in schema order.
  const component = new Map<TableId, number>()
  const components: TableId[][] = []
  for (const table of schema.tables) {
    if (!linked.has(table.id) || component.has(table.id)) continue
    const members: TableId[] = []
    const pending = [table.id]
    component.set(table.id, components.length)
    while (pending.length > 0) {
      const id = pending.pop() as TableId
      members.push(id)
      for (const other of [
        ...(parentsOf.get(id) ?? []),
        ...(childrenOf.get(id) ?? []),
      ]) {
        if (component.has(other)) continue
        component.set(other, components.length)
        pending.push(other)
      }
    }
    components.push(
      members.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0))
    )
  }

  const positions: Record<TableId, Point> = {}
  let cursorY = 0

  for (const members of components) {
    const placed = layoutComponent(members)
    let bottom = 0
    for (const [id, at] of placed) {
      positions[id] = { x: at.x, y: cursorY + at.y }
      bottom = Math.max(bottom, at.y + (height.get(id) ?? 0))
    }
    cursorY += bottom + componentGap
  }

  // Tables with no relationship: a grid below everything else.
  const loose = schema.tables.filter((table) => !linked.has(table.id))
  for (let start = 0; start < loose.length; start += looseColumns) {
    const row = loose.slice(start, start + looseColumns)
    row.forEach((table, column) => {
      positions[table.id] = { x: column * (NODE_WIDTH + gapX), y: cursorY }
    })
    cursorY += Math.max(...row.map((table) => height.get(table.id) ?? 0)) + gapY
  }

  const result: Record<TableId, Point> = {}
  for (const table of schema.tables) {
    const at = positions[table.id] ?? { x: 0, y: 0 }
    result[table.id] = { x: snap(origin.x + at.x), y: snap(origin.y + at.y) }
  }
  return result

  function layoutComponent(ids: TableId[]): Map<TableId, Point> {
    // Break cycles: an edge that closes one is ignored when choosing layers.
    const ignored = new Set<string>()
    const key = (child: TableId, parent: TableId) => `${child}>${parent}`
    const state = new Map<TableId, 1 | 2>()
    const walk = (id: TableId) => {
      state.set(id, 1)
      for (const parent of parentsOf.get(id) ?? []) {
        if (state.get(parent) === 1) ignored.add(key(id, parent))
        else if (!state.has(parent)) walk(parent)
      }
      state.set(id, 2)
    }
    for (const id of ids) if (!state.has(id)) walk(id)

    const parentsHere = (id: TableId) =>
      (parentsOf.get(id) ?? []).filter(
        (parent) => !ignored.has(key(id, parent))
      )
    const childrenHere = (id: TableId) =>
      (childrenOf.get(id) ?? []).filter((child) => !ignored.has(key(child, id)))
    const neighbours = (id: TableId) => [
      ...parentsHere(id),
      ...childrenHere(id),
    ]

    // Layer = one more than the deepest table it references.
    const layerOf = new Map<TableId, number>()
    const layerFor = (id: TableId): number => {
      const known = layerOf.get(id)
      if (known !== undefined) return known
      const layer = Math.max(-1, ...parentsHere(id).map(layerFor)) + 1
      layerOf.set(id, layer)
      return layer
    }
    for (const id of ids) layerFor(id)

    const layers: TableId[][] = []
    for (const id of ids) {
      const layer = layerOf.get(id) as number
      layers[layer] = [...(layers[layer] ?? []), id]
    }

    // Order inside each layer: sweep down and up, each table going to the
    // average position of its neighbours in the layers already placed.
    for (let pass = 0; pass < 8; pass++) {
      const down = pass % 2 === 0
      const sweep = down
        ? layers.map((_, layer) => layer).slice(1)
        : layers
            .map((_, layer) => layer)
            .slice(0, -1)
            .reverse()
      for (const layer of sweep) {
        const normalised = new Map<TableId, number>()
        for (const members of layers) {
          members.forEach((id, i) => {
            normalised.set(id, (i + 0.5) / members.length)
          })
        }
        const current = layers[layer] as TableId[]
        const score = (id: TableId) => {
          const near = neighbours(id).filter((other) =>
            down
              ? (layerOf.get(other) as number) < layer
              : (layerOf.get(other) as number) > layer
          )
          return near.length === 0
            ? (normalised.get(id) as number)
            : near.reduce(
                (sum, other) => sum + (normalised.get(other) as number),
                0
              ) / near.length
        }
        layers[layer] = current
          .map((id, i) => ({ id, i, score: score(id) }))
          .sort((a, b) => a.score - b.score || a.i - b.i)
          .map((entry) => entry.id)
      }
    }

    // Vertical position: stack, then move each table towards the middle of its
    // neighbours without letting two tables of a layer touch.
    const top = new Map<TableId, number>()
    for (const members of layers) {
      let y = 0
      for (const id of members) {
        top.set(id, y)
        y += (height.get(id) as number) + gapY
      }
    }
    const relax = (members: TableId[]) => {
      const desired = members.map((id) => {
        const near = neighbours(id)
        if (near.length === 0) return top.get(id) as number
        const centre =
          near.reduce(
            (sum, other) =>
              sum +
              (top.get(other) as number) +
              (height.get(other) as number) / 2,
            0
          ) / near.length
        return centre - (height.get(id) as number) / 2
      })
      let previousBottom = Number.NEGATIVE_INFINITY
      members.forEach((id, i) => {
        const at = Math.max(desired[i] as number, previousBottom + gapY)
        top.set(id, at)
        previousBottom = at + (height.get(id) as number)
      })
    }
    for (let pass = 0; pass < 6; pass++) {
      const order = layers.map((_, layer) => layer)
      for (const layer of pass % 2 === 0 ? order : order.reverse()) {
        relax(layers[layer] as TableId[])
      }
    }

    const lowest = Math.min(...ids.map((id) => top.get(id) as number))
    const placed = new Map<TableId, Point>()
    for (const id of ids) {
      placed.set(id, {
        x: (layerOf.get(id) as number) * (NODE_WIDTH + gapX),
        y: (top.get(id) as number) - lowest,
      })
    }
    return placed
  }
}
