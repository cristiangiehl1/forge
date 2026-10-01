import type { RelationshipId, TableId } from '@forge/core'

import type { NodePosition } from '../project-view.ts'

export interface CanvasActions {
  moveNode: (tableId: TableId, position: NodePosition) => void
  select: (tableId: TableId | null) => void
  removeRelationship: (relationshipId: RelationshipId) => void
  currentSelection: () => TableId | null
}

/** The part of a React Flow node change the app reads. */
export interface NodeChangeLike {
  type: string
  id?: string
  position?: NodePosition
  selected?: boolean
}

/** The part of a React Flow edge change the app reads. */
export interface EdgeChangeLike {
  type: string
  id?: string
  selected?: boolean
}

/**
 * The canvas is controlled: React Flow only reports what it wants to change and
 * the store decides. Only moves and selection are honored for nodes. A node
 * `remove` is deliberately never forwarded: tables are deleted from the
 * inspector, never by a keypress on the canvas.
 */
export function forwardNodeChanges(
  changes: readonly NodeChangeLike[],
  actions: CanvasActions
): void {
  for (const change of changes) {
    if (change.id === undefined) continue
    if (change.type === 'position' && change.position) {
      actions.moveNode(change.id, change.position)
    } else if (change.type === 'select') {
      if (change.selected) {
        actions.select(change.id)
      } else if (actions.currentSelection() === change.id) {
        actions.select(null)
      }
    }
  }
}

export function forwardEdgeChanges(
  changes: readonly EdgeChangeLike[],
  actions: CanvasActions
): void {
  for (const change of changes) {
    if (change.type === 'remove' && change.id !== undefined) {
      actions.removeRelationship(change.id)
    }
  }
}
