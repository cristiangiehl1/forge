import type { Point } from '../geometry.ts'
import type { RelationshipFlowEdge, TableFlowNode } from './to-flow.ts'

export const sameNode = (a: TableFlowNode, b: TableFlowNode): boolean =>
  a.id === b.id &&
  a.type === b.type &&
  a.position.x === b.position.x &&
  a.position.y === b.position.y &&
  a.selected === b.selected &&
  a.data.tableId === b.data.tableId

const samePoints = (a: Point[], b: Point[]): boolean =>
  a.length === b.length &&
  a.every((point, i) => point.x === b[i]?.x && point.y === b[i]?.y)

export const sameEdge = (
  a: RelationshipFlowEdge,
  b: RelationshipFlowEdge
): boolean =>
  a.id === b.id &&
  a.type === b.type &&
  a.source === b.source &&
  a.target === b.target &&
  a.sourceHandle === b.sourceHandle &&
  a.targetHandle === b.targetHandle &&
  a.selected === b.selected &&
  a.className === b.className &&
  samePoints(a.data?.points ?? [], b.data?.points ?? [])

/**
 * Rebuilding the nodes and edges on every change hands React Flow brand-new
 * objects, so it re-renders every table on every keystroke in the inspector.
 * The returned function keeps the previous object for anything that did not
 * change, and the previous array when nothing did.
 */
export function createStabilizer<T extends { id: string }>(
  same: (a: T, b: T) => boolean
): (next: T[]) => T[] {
  let previous: T[] = []
  return (next) => {
    const before = new Map(previous.map((item) => [item.id, item]))
    const stable = next.map((item) => {
      const old = before.get(item.id)
      return old && same(old, item) ? old : item
    })
    const unchanged =
      stable.length === previous.length &&
      stable.every((item, index) => item === previous[index])
    if (unchanged) return previous
    previous = stable
    return stable
  }
}
