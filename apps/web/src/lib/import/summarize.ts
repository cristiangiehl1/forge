import type { Schema } from '@forge/core'

export interface ImportSummary {
  tables: number
  columns: number
  relationships: number
  indexes: number
  types: number
}

export function summarize(schema: Schema): ImportSummary {
  return {
    tables: schema.tables.length,
    columns: schema.tables.reduce(
      (sum, table) => sum + table.columns.length,
      0
    ),
    relationships: schema.relationships.length,
    indexes: schema.tables.reduce(
      (sum, table) => sum + (table.indexes?.length ?? 0),
      0
    ),
    types: schema.types?.length ?? 0,
  }
}

const noun = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`

export function describeSummary(summary: ImportSummary): string {
  const parts = [
    summary.tables > 0 && noun(summary.tables, 'table', 'tables'),
    summary.columns > 0 && noun(summary.columns, 'column', 'columns'),
    summary.relationships > 0 &&
      noun(summary.relationships, 'relationship', 'relationships'),
    summary.indexes > 0 && noun(summary.indexes, 'index', 'indexes'),
    summary.types > 0 && noun(summary.types, 'type', 'types'),
  ].filter((part): part is string => part !== false)
  return parts.length === 0 ? 'nothing' : parts.join(', ')
}

export const isEmptyImport = (summary: ImportSummary): boolean =>
  summary.tables === 0 && summary.types === 0

/** The first `max` messages and how many were left out. */
export function limitMessages<T>(
  list: T[],
  max: number
): { shown: T[]; hidden: number } {
  return { shown: list.slice(0, max), hidden: Math.max(0, list.length - max) }
}
