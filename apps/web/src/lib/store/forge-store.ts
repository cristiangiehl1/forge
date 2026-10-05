import type {
  Column,
  ColumnId,
  ColumnRef,
  DialectId,
  DialectOptions,
  Index,
  IndexId,
  Issue,
  ParseError,
  RelationshipId,
  Schema,
  TableId,
  TypeId,
  TypeUsage,
  UserType,
} from '@forge/core'
import * as core from '@forge/core'
import { createStore } from 'zustand/vanilla'

import type { LoadResult } from '../../queries/project/load-project.ts'
import { createRecruitmentExample } from '../example/recruitment-example.ts'
import { createShopExample } from '../example/shop-example.ts'
import type { History, Snapshot } from '../history/history.ts'
import { emptyHistory, record, redoStep, undoStep } from '../history/history.ts'
import { mergeImported } from '../import/merge-schema.ts'
import { placeAdded } from '../import/place-added.ts'
import { defaultIndexName, renamedByDefault } from '../index-names.ts'
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
  /** The database the DDL is written for; saved with the project, not an undo step. */
  dialect: DialectId
  dialectOptions: DialectOptions
  /** The steps that can be undone and redone; in memory only. */
  history: History
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
  setDialect: (dialect: DialectId) => void
  setDialectOptions: (options: DialectOptions) => void
  startNewProject: () => void
  /** Replaces the project with a ready-made example to look at. */
  loadExample: (name?: 'shop' | 'recruitment') => void
  /** Takes back the last step; does nothing when there is none. */
  undo: () => void
  redo: () => void
  /**
   * Puts an imported schema in the project: `replace` swaps the project for it,
   * `add` appends it, renaming what collides. An empty project is always a replace.
   */
  importSchema: (imported: Schema, mode: 'replace' | 'add') => void

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
  setTableComment: (tableId: TableId, comment: string) => void

  /** Starts on the table's first column; null when the table has none. */
  addIndex: (tableId: TableId) => IndexId | null
  updateIndex: (
    tableId: TableId,
    indexId: IndexId,
    patch: Partial<Omit<Index, 'id'>>
  ) => void
  removeIndex: (tableId: TableId, indexId: IndexId) => void

  addType: (kind: 'enum' | 'domain') => TypeId
  updateType: (type: UserType) => void
  /** Empty when removed; what still uses the type, with nothing changed, otherwise. */
  removeType: (typeId: TypeId) => TypeUsage[]

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
  /** The clock, for grouping edits. Defaults to Date.now. */
  now?: () => number
}

const emptyProject = () => ({
  schema: core.createSchema(),
  view: createView(),
  selection: null,
  relationshipSelection: null,
  hoveredTable: null,
  history: emptyHistory(),
  dialect: 'postgres' as DialectId,
  dialectOptions: {} as DialectOptions,
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

/**
 * The grouping key of an edit made by typing: `prefix` plus the fields it
 * touches. A click (a checkbox, a choice of columns) is never grouped, or two
 * quick clicks would be one step that cancels itself out.
 */
function typingKey(prefix: string, patch: object): string | null {
  const values = Object.values(patch)
  if (
    values.some((value) => typeof value === 'boolean' || Array.isArray(value))
  ) {
    return null
  }
  return `${prefix}:${Object.keys(patch).sort().join(',')}`
}

/** The fields of an updated type that differ from the stored one. */
function changedFields(before: object | undefined, after: object): string {
  const old = (before ?? {}) as Record<string, unknown>
  return Object.entries(after)
    .filter(([key, value]) => !Object.is(old[key], value))
    .map(([key]) => key)
    .sort()
    .join(',')
}

/** `base`, or `base_2`, `base_3`… until it is not taken. */
function freeName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base
  let attempt = 2
  while (taken.includes(`${base}_${attempt}`)) attempt++
  return `${base}_${attempt}`
}

export function createForgeStore({ newId, now = Date.now }: ForgeStoreDeps) {
  return createStore<ForgeState>()((set, get) => {
    /** Applies a change; when it touches the schema or the positions, it is a step. */
    const edit = (
      key: string | null,
      change: Partial<ForgeState>,
      fit = false
    ) => {
      const { schema, view, history } = get()
      const touches =
        (change.schema !== undefined && change.schema !== schema) ||
        (change.view !== undefined && change.view.nodes !== view.nodes)
      if (!touches) {
        set(change)
        return
      }
      set({
        ...change,
        history: record(
          history,
          { schema, nodes: view.nodes },
          key,
          now(),
          fit
        ),
      })
    }
    /** A project-level step: loading the example, importing. Undoing it fits the canvas. */
    const editProject = (change: Partial<ForgeState>) =>
      edit(null, change, true)

    /** Puts a snapshot in place, keeping the viewport and dropping what points at nothing. */
    const restore = (snapshot: Snapshot, next: History, fit: boolean) => {
      const {
        view,
        selection,
        hoveredTable,
        relationshipSelection,
        fitRequest,
      } = get()
      const exists = (id: TableId | null) =>
        id !== null && snapshot.schema.tables.some((table) => table.id === id)
      set({
        schema: snapshot.schema,
        view: { ...view, nodes: snapshot.nodes },
        history: next,
        selection: exists(selection) ? selection : null,
        hoveredTable: exists(hoveredTable) ? hoveredTable : null,
        relationshipSelection: stillSelected(
          snapshot.schema,
          relationshipSelection
        ),
        ...(fit ? { fitRequest: fitRequest + 1 } : {}),
      })
    }

    return {
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
      setDialect: (dialect) => set({ dialect }),
      setDialectOptions: (dialectOptions) => set({ dialectOptions }),
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
              dialect: result.project.dialect ?? 'postgres',
              dialectOptions: result.project.options ?? {},
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
        set({ projectEpoch: get().projectEpoch + 1, history: emptyHistory() })
      },

      loadExample: (name = 'shop') => {
        const { schema, view } =
          name === 'recruitment'
            ? createRecruitmentExample()
            : createShopExample()
        editProject({
          schema,
          view,
          // The recruitment system lives in Oracle: its example says so.
          ...(name === 'recruitment'
            ? { dialect: 'oracle' as DialectId, dialectOptions: {} }
            : {}),
          selection: null,
          relationshipSelection: null,
          hoveredTable: null,
          persistence: 'ready',
          notice: null,
          projectEpoch: get().projectEpoch + 1,
          fitRequest: get().fitRequest + 1,
        })
      },

      undo: () => {
        const { schema, view, history } = get()
        const result = undoStep(history, { schema, nodes: view.nodes })
        if (result) {
          restore(result.entry.snapshot, result.history, result.entry.fit)
        }
      },

      redo: () => {
        const { schema, view, history } = get()
        const result = redoStep(history, { schema, nodes: view.nodes })
        if (result) {
          restore(result.entry.snapshot, result.history, result.entry.fit)
        }
      },

      importSchema: (imported, mode) => {
        const { schema, view } = get()
        const empty =
          schema.tables.length === 0 && (schema.types ?? []).length === 0
        if (mode === 'replace' || empty) {
          editProject({
            schema: imported,
            view: { ...createView(), nodes: layoutTables(imported) },
            selection: null,
            relationshipSelection: null,
            hoveredTable: null,
            persistence: 'ready',
            notice: null,
            projectEpoch: get().projectEpoch + 1,
            fitRequest: get().fitRequest + 1,
          })
          return
        }
        const merged = mergeImported(schema, imported)
        const positions = placeAdded(
          schema,
          view,
          merged.schema,
          merged.addedTableIds
        )
        editProject({
          schema: merged.schema,
          view: { ...view, nodes: { ...view.nodes, ...positions } },
          selection: null,
          relationshipSelection: null,
          hoveredTable: null,
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
        edit(null, {
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
        edit(`rename:${tableId}`, {
          schema: core.renameTable(get().schema, tableId, name),
        }),

      removeTable: (tableId) => {
        const { schema, view, selection, relationshipSelection, hoveredTable } =
          get()
        if (!schema.tables.some((table) => table.id === tableId)) return
        const { [tableId]: _removed, ...nodes } = view.nodes
        const next = core.removeTable(schema, tableId)
        edit(null, {
          schema: next,
          view: { ...view, nodes },
          selection: selection === tableId ? null : selection,
          hoveredTable: hoveredTable === tableId ? null : hoveredTable,
          relationshipSelection: stillSelected(next, relationshipSelection),
        })
      },

      addColumn: (tableId) => {
        const { schema } = get()
        const table = schema.tables.find(
          (candidate) => candidate.id === tableId
        )
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
        edit(null, { schema: core.addColumn(schema, tableId, column) })
        return id
      },

      updateColumn: (tableId, columnId, patch) =>
        edit(typingKey(`column:${tableId}:${columnId}`, patch), {
          schema: core.updateColumn(get().schema, tableId, columnId, patch),
        }),

      removeColumn: (tableId, columnId) => {
        const next = core.removeColumn(get().schema, tableId, columnId)
        edit(null, {
          schema: next,
          relationshipSelection: stillSelected(
            next,
            get().relationshipSelection
          ),
        })
      },

      setPrimaryKey: (tableId, columnIds) =>
        edit(null, {
          schema: core.setPrimaryKey(get().schema, tableId, columnIds),
        }),

      setTableComment: (tableId, comment) =>
        edit(`comment:${tableId}`, {
          schema: core.setTableComment(get().schema, tableId, comment),
        }),

      addIndex: (tableId) => {
        const { schema } = get()
        const table = schema.tables.find(
          (candidate) => candidate.id === tableId
        )
        const first = table?.columns[0]
        if (!table || !first) return null
        const taken = schema.tables.flatMap((candidate) =>
          (candidate.indexes ?? []).map((index) => index.name)
        )
        const id = newId()
        const index: Index = {
          id,
          name: freeName(
            defaultIndexName(table.name, [first.name], false),
            taken
          ),
          columns: [first.id],
          unique: false,
          method: 'btree',
        }
        edit(null, { schema: core.addIndex(schema, tableId, index) })
        return id
      },

      updateIndex: (tableId, indexId, patch) => {
        const { schema } = get()
        const table = schema.tables.find(
          (candidate) => candidate.id === tableId
        )
        const index = table?.indexes?.find(
          (candidate) => candidate.id === indexId
        )
        let applied = patch
        if (table && index && patch.name === undefined) {
          const names = (ids: string[]) =>
            ids.map((id) => table.columns.find((c) => c.id === id)?.name ?? '')
          const renamed = renamedByDefault(
            {
              table: table.name,
              name: index.name,
              columns: names(index.columns),
              unique: index.unique,
            },
            {
              ...(patch.columns ? { columns: names(patch.columns) } : {}),
              ...(patch.unique === undefined ? {} : { unique: patch.unique }),
            }
          )
          if (renamed !== null) {
            const taken = schema.tables.flatMap((candidate) =>
              (candidate.indexes ?? [])
                .filter((other) => other.id !== indexId)
                .map((other) => other.name)
            )
            applied = { ...patch, name: freeName(renamed, taken) }
          }
        }
        edit(typingKey(`index:${tableId}:${indexId}`, patch), {
          schema: core.updateIndex(schema, tableId, indexId, applied),
        })
      },

      removeIndex: (tableId, indexId) =>
        edit(null, {
          schema: core.removeIndex(get().schema, tableId, indexId),
        }),

      addType: (kind) => {
        const { schema } = get()
        const id = newId()
        const name = firstFreeName(
          'type',
          (schema.types ?? []).map((type) => type.name)
        )
        const type: UserType =
          kind === 'enum'
            ? { kind: 'enum', id, name, values: ['value_1'] }
            : { kind: 'domain', id, name, base: { kind: 'text' } }
        edit(null, { schema: core.addType(schema, type) })
        return id
      },

      updateType: (type) => {
        const stored = get().schema.types?.find((t) => t.id === type.id)
        edit(`type:${type.id}:${changedFields(stored, type)}`, {
          schema: core.updateType(get().schema, type),
        })
      },

      removeType: (typeId) => {
        const usages = core.typeUsages(get().schema, typeId)
        if (usages.length > 0) return usages
        edit(null, { schema: core.removeType(get().schema, typeId) })
        return []
      },

      connect: (from, to) => {
        const { schema } = get()
        const issue = core.checkRelationship(schema, from, to)
        if (issue) return issue
        edit(null, {
          schema: core.addRelationship(schema, { id: newId(), from, to }),
        })
        return null
      },

      removeRelationship: (relationshipId) => {
        const next = core.removeRelationship(get().schema, relationshipId)
        edit(null, {
          schema: next,
          relationshipSelection: stillSelected(
            next,
            get().relationshipSelection
          ),
        })
      },

      moveNode: (tableId, position) => {
        const { view } = get()
        const there = view.nodes[tableId]
        // React Flow reports the last position again when a drag ends: after a
        // pause that would be a step that changes nothing.
        if (there && there.x === position.x && there.y === position.y) return
        edit(`move:${tableId}`, {
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
        edit(null, {
          view: { ...view, nodes: layoutTables(schema) },
          fitRequest: get().fitRequest + 1,
        })
      },

      clearSelection: () =>
        set({ selection: null, relationshipSelection: null }),
    }
  })
}
