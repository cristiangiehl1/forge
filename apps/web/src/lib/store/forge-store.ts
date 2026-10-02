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
import { createShopExample } from '../example/shop-example.ts'
import { layoutTables } from '../layout/layout-tables.ts'
import type { NodePosition, ProjectView, Viewport } from '../project-view.ts'
import {
  createView,
  nextNodePosition,
  parseView,
  pruneView,
} from '../project-view.ts'
import type { AppSettings, NewTableId } from '../settings/settings.ts'
import { DEFAULT_SETTINGS } from '../settings/settings.ts'

/** `blocked` means the stored project could not be read: do not overwrite it. */
export type PersistenceMode = 'ready' | 'blocked'

export type StartupNotice =
  | { kind: 'invalid'; errors: ParseError[] }
  | { kind: 'unavailable'; message: string }

export interface ForgeState {
  schema: Schema
  view: ProjectView
  selection: TableId | null
  /** At most one of `selection` and `relationshipSelection` is set. */
  relationshipSelection: RelationshipId | null
  /** The table the pointer is over: it is highlighted, and so is its part of the script. */
  hoveredTable: TableId | null
  /** Moves on when a layout was applied and the canvas should zoom to fit it. */
  fitRequest: number
  /** App preferences: they outlive any one project. */
  settings: AppSettings
  /** Moves on whenever a project is loaded or restarted, never while editing. */
  projectEpoch: number
  hydrated: boolean
  persistence: PersistenceMode
  notice: StartupNotice | null

  hydrate: (result: LoadResult) => void
  hydrateSettings: (settings: AppSettings) => void
  setNewTableId: (newTableId: NewTableId) => void
  setNewTableTimestamps: (enabled: boolean) => void
  startNewProject: () => void
  /** Replaces the project with a ready-made example to look at. */
  loadExample: () => void

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
  hoverTable: (tableId: TableId | null) => void
  /** Moves every table to where its relationships say it belongs. */
  autoLayout: () => void
  selectRelationship: (relationshipId: RelationshipId | null) => void
  clearSelection: () => void
}

export interface ForgeStoreDeps {
  /** Produces a fresh id. The web passes `crypto.randomUUID`. */
  newId: () => string
}

const emptyProject = () => ({
  schema: core.createSchema(),
  view: createView(),
  selection: null,
  relationshipSelection: null,
  hoveredTable: null,
})

/** A relationship selection survives only while that relationship exists. */
const stillSelected = (schema: Schema, id: RelationshipId | null) =>
  id !== null && schema.relationships.some((r) => r.id === id) ? id : null

/** The smallest unused `prefix_N`, counting from 1. */
function firstFreeName(prefix: string, taken: string[]): string {
  let attempt = 1
  while (taken.includes(`${prefix}_${attempt}`)) attempt++
  return `${prefix}_${attempt}`
}

export function createForgeStore({ newId }: ForgeStoreDeps) {
  return createStore<ForgeState>()((set, get) => ({
    ...emptyProject(),
    settings: DEFAULT_SETTINGS,
    projectEpoch: 0,
    fitRequest: 0,
    hydrated: false,
    persistence: 'ready',
    notice: null,

    hydrateSettings: (settings) => set({ settings }),

    setNewTableId: (newTableId) =>
      set({ settings: { ...get().settings, newTableId } }),
    setNewTableTimestamps: (newTableTimestamps) =>
      set({ settings: { ...get().settings, newTableTimestamps } }),

    hydrate: (result) => {
      switch (result.status) {
        case 'loaded':
          set({
            schema: result.project.schema,
            view: pruneView(
              parseView(result.project.view),
              result.project.schema.tables.map((table) => table.id)
            ),
            selection: null,
            relationshipSelection: null,
            hoveredTable: null,
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
            // Nothing can be saved, so do not try: one banner says so.
            persistence: 'blocked',
            notice: { kind: 'unavailable', message: result.message },
          })
          break
      }
      set({ projectEpoch: get().projectEpoch + 1 })
    },

    loadExample: () => {
      const { schema, view } = createShopExample()
      set({
        schema,
        view,
        selection: null,
        relationshipSelection: null,
        hoveredTable: null,
        persistence: 'ready',
        notice: null,
        projectEpoch: get().projectEpoch + 1,
        fitRequest: get().fitRequest + 1,
      })
    },

    startNewProject: () =>
      set({
        ...emptyProject(),
        persistence: 'ready',
        notice: null,
        projectEpoch: get().projectEpoch + 1,
      }),

    addTable: () => {
      const { schema, view, settings } = get()
      const id = newId()
      const name = firstFreeName(
        'table',
        schema.tables.map((table) => table.name)
      )
      let next = core.addTable(schema, { id, name })
      if (settings.newTableId !== 'none') {
        const columnId = newId()
        next = core.addColumn(next, id, {
          id: columnId,
          name: 'id',
          type: { kind: settings.newTableId },
          nullable: false,
          generated: true,
        })
        next = core.setPrimaryKey(next, id, [columnId])
      }
      if (settings.newTableTimestamps) {
        for (const columnName of ['created_at', 'updated_at']) {
          next = core.addColumn(next, id, {
            id: newId(),
            name: columnName,
            type: { kind: 'timestamp' },
            nullable: false,
            generated: true,
          })
        }
      }
      set({
        schema: next,
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
      const { schema, view, selection, relationshipSelection, hoveredTable } =
        get()
      if (!schema.tables.some((table) => table.id === tableId)) return
      const { [tableId]: _removed, ...nodes } = view.nodes
      const next = core.removeTable(schema, tableId)
      set({
        schema: next,
        view: { ...view, nodes },
        selection: selection === tableId ? null : selection,
        hoveredTable: hoveredTable === tableId ? null : hoveredTable,
        relationshipSelection: stillSelected(next, relationshipSelection),
      })
    },

    addColumn: (tableId) => {
      const { schema } = get()
      const table = schema.tables.find((candidate) => candidate.id === tableId)
      if (!table) return null
      const id = newId()
      const column: Column = {
        id,
        name: firstFreeName(
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

    removeColumn: (tableId, columnId) => {
      const next = core.removeColumn(get().schema, tableId, columnId)
      set({
        schema: next,
        relationshipSelection: stillSelected(next, get().relationshipSelection),
      })
    },

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

    removeRelationship: (relationshipId) => {
      const next = core.removeRelationship(get().schema, relationshipId)
      set({
        schema: next,
        relationshipSelection: stillSelected(next, get().relationshipSelection),
      })
    },

    moveNode: (tableId, position) => {
      const { view } = get()
      set({
        view: { ...view, nodes: { ...view.nodes, [tableId]: position } },
      })
    },

    setViewport: (viewport) => set({ view: { ...get().view, viewport } }),

    // Deselecting a table must not clear a relationship that was just selected:
    // React Flow reports "table deselected" in the same batch as "edge selected".
    select: (tableId) =>
      set(
        tableId === null
          ? { selection: null }
          : { selection: tableId, relationshipSelection: null }
      ),

    selectRelationship: (relationshipId) =>
      set(
        relationshipId === null
          ? { relationshipSelection: null }
          : { relationshipSelection: relationshipId, selection: null }
      ),

    hoverTable: (tableId) => set({ hoveredTable: tableId }),

    autoLayout: () => {
      const { schema, view } = get()
      if (schema.tables.length === 0) return
      set({
        view: { ...view, nodes: layoutTables(schema) },
        fitRequest: get().fitRequest + 1,
      })
    },

    clearSelection: () => set({ selection: null, relationshipSelection: null }),
  }))
}
