import type { TableId } from '@forge/core'

export interface NodePosition {
  x: number
  y: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** What the web stores in the opaque `view` slot of the saved project. */
export interface ProjectView {
  nodes: Record<TableId, NodePosition>
  viewport: Viewport
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

export function createView(): ProjectView {
  return { nodes: {}, viewport: DEFAULT_VIEWPORT }
}

/** Where the Nth new table node goes: a three-column grid. */
export function nextNodePosition(existingCount: number): NodePosition {
  return {
    x: 40 + (existingCount % 3) * 320,
    y: 40 + Math.floor(existingCount / 3) * 260,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function parsePosition(raw: unknown): NodePosition | null {
  if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
    return null
  }
  return { x: raw.x, y: raw.y }
}

function parseViewport(raw: unknown): Viewport {
  if (
    isRecord(raw) &&
    isFiniteNumber(raw.x) &&
    isFiniteNumber(raw.y) &&
    isFiniteNumber(raw.zoom) &&
    raw.zoom > 0
  ) {
    return { x: raw.x, y: raw.y, zoom: raw.zoom }
  }
  return DEFAULT_VIEWPORT
}

/**
 * Reads the opaque `view` of a saved project. The view is cosmetic, so a
 * malformed one is replaced by defaults instead of failing the whole load.
 */
export function parseView(input: unknown): ProjectView {
  if (!isRecord(input)) return createView()

  const entries: [string, NodePosition][] = []
  if (isRecord(input.nodes)) {
    for (const [tableId, raw] of Object.entries(input.nodes)) {
      const position = parsePosition(raw)
      if (position) entries.push([tableId, position])
    }
  }

  // fromEntries defines own properties, so a table id of "__proto__" cannot
  // reach the prototype the way `nodes[id] = position` could.
  return {
    nodes: Object.fromEntries(entries),
    viewport: parseViewport(input.viewport),
  }
}
