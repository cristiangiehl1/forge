import type { Schema, TableId } from '@forge/core'

import type { NodePosition } from '../project-view.ts'

/** What an undo restores: the schema and where the tables are. Not the zoom. */
export interface Snapshot {
  schema: Schema
  nodes: Record<TableId, NodePosition>
}

export interface Entry {
  snapshot: Snapshot
  /** A project-level step (load example, import): undoing it asks the canvas to fit. */
  fit: boolean
}

export interface History {
  past: Entry[]
  future: Entry[]
  /** What the last edit was about, to group a run of edits to one field. */
  lastKey: string | null
  lastAt: number
}

export const MAX_STEPS = 100
/** Edits to the same field closer together than this are one step. */
export const GROUP_MS = 1000

export const emptyHistory = (): History => ({
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
})

export const canUndo = (history: History): boolean => history.past.length > 0
export const canRedo = (history: History): boolean => history.future.length > 0

/** Records an edit that is about to happen: `before` is the state it leaves. */
export function record(
  history: History,
  before: Snapshot,
  key: string | null,
  now: number,
  fit = false
): History {
  const groups =
    key !== null &&
    key === history.lastKey &&
    now - history.lastAt < GROUP_MS &&
    history.past.length > 0
  if (groups) return { ...history, future: [], lastAt: now }
  const past = [...history.past, { snapshot: before, fit }].slice(-MAX_STEPS)
  return { past, future: [], lastKey: key, lastAt: now }
}

export function undoStep(
  history: History,
  current: Snapshot
): { history: History; entry: Entry } | null {
  const entry = history.past[history.past.length - 1]
  if (!entry) return null
  return {
    entry,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, { snapshot: current, fit: entry.fit }],
      lastKey: null,
      lastAt: 0,
    },
  }
}

export function redoStep(
  history: History,
  current: Snapshot
): { history: History; entry: Entry } | null {
  const entry = history.future[history.future.length - 1]
  if (!entry) return null
  return {
    entry,
    history: {
      past: [...history.past, { snapshot: current, fit: entry.fit }],
      future: history.future.slice(0, -1),
      lastKey: null,
      lastAt: 0,
    },
  }
}
