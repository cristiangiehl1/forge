import type {
  Column,
  ColumnId,
  ColumnRef,
  Issue,
  ParseError,
  RelationshipId,
  Schema,
  TableId,
} from '@forge/core'
import * as core from '@forge/core'
import { createStore } from 'zustand/vanilla'

import type { LoadResult } from '../../queries/project/load-project.ts'
import type { NodePosition, ProjectView, Viewport } from '../project-view.ts'
import { createView, nextNodePosition, parseView } from '../project-view.ts'

/** `blocked` means the stored project could not be read: do not overwrite it. */
export type PersistenceMode = 'ready' | 'blocked'

export type StartupNotice =
  | { kind: 'invalid'; errors: ParseError[] }
  | { kind: 'unavailable'; message: string }

export interface ForgeState {
  schema: Schema
  view: ProjectView
  selection: TableId | null
  hydrated: boolean
  persistence: PersistenceMode
  notice: StartupNotice | null

  hydrate: (result: LoadResult) => void
  startNewProject: () => void

  addTable: () => TableId
  renameTable: (tableId: TableId, name: string) => void
  removeTable: (tableId: TableId) => void

  addColumn: (tableId: TableId) => ColumnId | null
  updateColumn: (
    tableId: TableId,
    columnId: ColumnId,
    patch: Partial<Omit<Column, 'id'>>
  ) => void
  removeColumn: (tableId: TableId, columnId: ColumnId) => void
  setPrimaryKey: (tableId: TableId, columnIds: ColumnId[]) => void

  connect: (from: ColumnRef, to: ColumnRef) => Issue | null
  removeRelationship: (relationshipId: RelationshipId) => void

  moveNode: (tableId: TableId, position: NodePosition) => void
  setViewport: (viewport: Viewport) => void
  select: (tableId: TableId | null) => void
}

export interface ForgeStoreDeps {
  /** Produces a fresh id. The web passes `crypto.randomUUID`. */
  newId: () => string
}

const emptyProject = () => ({
  schema: core.createSchema(),
  view: createView(),
  selection: null,
})

function nextName(prefix: string, taken: string[]): string {
  let attempt = taken.length + 1
  while (taken.includes(`${prefix}_${attempt}`)) attempt++
  return `${prefix}_${attempt}`
}

export function createForgeStore({ newId }: ForgeStoreDeps) {
  return createStore<ForgeState>()((set, get) => ({
    ...emptyProject(),
    hydrated: false,
    persistence: 'ready',
    notice: null,

    hydrate: (result) => {
      switch (result.status) {
        case 'loaded':
          set({
            schema: result.project.schema,
            view: parseView(result.project.view),
            selection: null,
            hydrated: true,
            persistence: 'ready',
            notice: null,
          })
          break
        case 'empty':
          set({
            ...emptyProject(),
            hydrated: true,
            persistence: 'ready',
            notice: null,
          })
          break
        case 'invalid':
          set({
            ...emptyProject(),
            hydrated: true,
            persistence: 'blocked',
            notice: { kind: 'invalid', errors: result.errors },
          })
          break
        case 'unavailable':
          set({
            ...emptyProject(),
            hydrated: true,
            persistence: 'ready',
            notice: { kind: 'unavailable', message: result.message },
          })
          break
      }
    },

    startNewProject: () =>
      set({ ...emptyProject(), persistence: 'ready', notice: null }),

    addTable: () => {
      const { schema, view } = get()
      const id = newId()
      const name = nextName(
        'table',
        schema.tables.map((table) => table.name)
      )
      set({
        schema: core.addTable(schema, { id, name }),
        view: {
          ...view,
          nodes: {
            ...view.nodes,
            [id]: nextNodePosition(schema.tables.length),
          },
        },
        selection: id,
      })
      return id
    },

    renameTable: (tableId, name) =>
      set({ schema: core.renameTable(get().schema, tableId, name) }),

    removeTable: (tableId) => {
      const { schema, view, selection } = get()
      const { [tableId]: _removed, ...nodes } = view.nodes
      set({
        schema: core.removeTable(schema, tableId),
        view: { ...view, nodes },
        selection: selection === tableId ? null : selection,
      })
    },

    addColumn: (tableId) => {
      const { schema } = get()
      const table = schema.tables.find((candidate) => candidate.id === tableId)
      if (!table) return null
      const id = newId()
      const column: Column = {
        id,
        name: nextName(
          'column',
          table.columns.map((existing) => existing.name)
        ),
        type: { kind: 'text' },
        nullable: true,
      }
      set({ schema: core.addColumn(schema, tableId, column) })
      return id
    },

    updateColumn: (tableId, columnId, patch) =>
      set({
        schema: core.updateColumn(get().schema, tableId, columnId, patch),
      }),

    removeColumn: (tableId, columnId) =>
      set({ schema: core.removeColumn(get().schema, tableId, columnId) }),

    setPrimaryKey: (tableId, columnIds) =>
      set({ schema: core.setPrimaryKey(get().schema, tableId, columnIds) }),

    connect: (from, to) => {
      const { schema } = get()
      const issue = core.checkRelationship(schema, from, to)
      if (issue) return issue
      set({
        schema: core.addRelationship(schema, { id: newId(), from, to }),
      })
      return null
    },

    removeRelationship: (relationshipId) =>
      set({
        schema: core.removeRelationship(get().schema, relationshipId),
      }),

    moveNode: (tableId, position) => {
      const { view } = get()
      set({
        view: { ...view, nodes: { ...view.nodes, [tableId]: position } },
      })
    },

    setViewport: (viewport) => set({ view: { ...get().view, viewport } }),

    select: (tableId) => set({ selection: tableId }),
  }))
}
