import type {
  Column,
  ColumnType,
  Relationship,
  Schema,
  SimpleColumnKind,
  Table,
} from '../schema/types.ts'
import {
  MAX_NUMERIC_PRECISION,
  MAX_VARCHAR_LENGTH,
  SIMPLE_COLUMN_KINDS,
} from '../schema/types.ts'
import type { Project } from './project.ts'
import { CURRENT_FORMAT_VERSION } from './project.ts'

export interface ParseError {
  path: string
  message: string
}

export type ParseResult =
  | { ok: true; project: Project }
  | { ok: false; errors: ParseError[] }

type Fail = (path: string, message: string) => void

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

function readString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fail: Fail
): string | undefined {
  const value = source[key]
  if (typeof value !== 'string') {
    fail(`${path}.${key}`, `"${key}" must be a string.`)
    return undefined
  }
  return value
}

function parseType(
  raw: unknown,
  path: string,
  fail: Fail
): ColumnType | undefined {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    fail(path, 'A column type must be an object with a "kind".')
    return undefined
  }
  const { kind } = raw
  if ((SIMPLE_COLUMN_KINDS as readonly string[]).includes(kind)) {
    return { kind: kind as SimpleColumnKind }
  }
  if (kind === 'varchar') {
    const length = raw.length
    if (!isInteger(length) || length < 1 || length > MAX_VARCHAR_LENGTH) {
      fail(
        path,
        `varchar needs an integer length from 1 to ${MAX_VARCHAR_LENGTH}.`
      )
      return undefined
    }
    return { kind: 'varchar', length }
  }
  if (kind === 'numeric') {
    const { precision, scale } = raw
    if (
      !isInteger(precision) ||
      !isInteger(scale) ||
      precision < 1 ||
      precision > MAX_NUMERIC_PRECISION ||
      scale < 0 ||
      scale > precision
    ) {
      fail(
        path,
        `numeric needs an integer precision from 1 to ${MAX_NUMERIC_PRECISION} and a scale from 0 to the precision.`
      )
      return undefined
    }
    return { kind: 'numeric', precision, scale }
  }
  fail(path, `Unknown column type "${kind}".`)
  return undefined
}

function parseColumn(
  raw: unknown,
  path: string,
  fail: Fail
): Column | undefined {
  if (!isRecord(raw)) {
    fail(path, 'A column must be an object.')
    return undefined
  }
  const id = readString(raw, 'id', path, fail)
  const name = readString(raw, 'name', path, fail)
  const type = parseType(raw.type, `${path}.type`, fail)
  if (typeof raw.nullable !== 'boolean') {
    fail(`${path}.nullable`, '"nullable" must be a boolean.')
    return undefined
  }
  if (id === undefined || name === undefined || type === undefined) {
    return undefined
  }
  return { id, name, type, nullable: raw.nullable }
}

function parseTable(raw: unknown, path: string, fail: Fail): Table | undefined {
  if (!isRecord(raw)) {
    fail(path, 'A table must be an object.')
    return undefined
  }
  const id = readString(raw, 'id', path, fail)
  const name = readString(raw, 'name', path, fail)
  if (!Array.isArray(raw.columns)) {
    fail(`${path}.columns`, '"columns" must be an array.')
    return undefined
  }
  if (!Array.isArray(raw.primaryKey)) {
    fail(`${path}.primaryKey`, '"primaryKey" must be an array.')
    return undefined
  }

  const columns: Column[] = []
  const columnIds = new Set<string>()
  raw.columns.forEach((rawColumn: unknown, index: number) => {
    const columnPath = `${path}.columns[${index}]`
    const column = parseColumn(rawColumn, columnPath, fail)
    if (!column) return
    if (columnIds.has(column.id)) {
      fail(`${columnPath}.id`, `Duplicate column id "${column.id}".`)
      return
    }
    columnIds.add(column.id)
    columns.push(column)
  })

  const primaryKey: string[] = []
  raw.primaryKey.forEach((entry: unknown, index: number) => {
    if (typeof entry !== 'string' || !columnIds.has(entry)) {
      fail(
        `${path}.primaryKey[${index}]`,
        'A primary key entry must be the id of a column of the table.'
      )
      return
    }
    primaryKey.push(entry)
  })

  if (id === undefined || name === undefined) return undefined
  return { id, name, columns, primaryKey }
}

function parseColumnRef(
  raw: unknown,
  path: string,
  tables: Table[],
  fail: Fail
): { tableId: string; columnId: string } | undefined {
  if (
    !isRecord(raw) ||
    typeof raw.tableId !== 'string' ||
    typeof raw.columnId !== 'string'
  ) {
    fail(path, 'A column reference needs a "tableId" and a "columnId".')
    return undefined
  }
  const { tableId, columnId } = raw
  const table = tables.find((candidate) => candidate.id === tableId)
  if (!table?.columns.some((column) => column.id === columnId)) {
    fail(path, `The column "${tableId}.${columnId}" does not exist.`)
    return undefined
  }
  return { tableId, columnId }
}

function parseSchema(
  raw: unknown,
  path: string,
  fail: Fail
): Schema | undefined {
  if (!isRecord(raw)) {
    fail(path, 'The schema must be an object.')
    return undefined
  }
  if (raw.version !== 1) {
    fail(
      `${path}.version`,
      `Unsupported schema version ${JSON.stringify(raw.version)}.`
    )
    return undefined
  }
  if (!Array.isArray(raw.tables)) {
    fail(`${path}.tables`, '"tables" must be an array.')
    return undefined
  }
  if (!Array.isArray(raw.relationships)) {
    fail(`${path}.relationships`, '"relationships" must be an array.')
    return undefined
  }

  const tables: Table[] = []
  const tableIds = new Set<string>()
  raw.tables.forEach((rawTable: unknown, index: number) => {
    const tablePath = `${path}.tables[${index}]`
    const table = parseTable(rawTable, tablePath, fail)
    if (!table) return
    if (tableIds.has(table.id)) {
      fail(`${tablePath}.id`, `Duplicate table id "${table.id}".`)
      return
    }
    tableIds.add(table.id)
    tables.push(table)
  })

  const relationships: Relationship[] = []
  const relationshipIds = new Set<string>()
  raw.relationships.forEach((rawRelationship: unknown, index: number) => {
    const relationshipPath = `${path}.relationships[${index}]`
    if (!isRecord(rawRelationship)) {
      fail(relationshipPath, 'A relationship must be an object.')
      return
    }
    const id = readString(rawRelationship, 'id', relationshipPath, fail)
    const from = parseColumnRef(
      rawRelationship.from,
      `${relationshipPath}.from`,
      tables,
      fail
    )
    const to = parseColumnRef(
      rawRelationship.to,
      `${relationshipPath}.to`,
      tables,
      fail
    )
    if (id === undefined || !from || !to) return
    if (relationshipIds.has(id)) {
      fail(`${relationshipPath}.id`, `Duplicate relationship id "${id}".`)
      return
    }
    relationshipIds.add(id)
    relationships.push({ id, from, to })
  })

  return { version: 1, tables, relationships }
}

export function parseProject(input: unknown): ParseResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'A project must be an object.' }],
    }
  }
  if (input.formatVersion !== CURRENT_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        {
          path: 'formatVersion',
          message: `Unsupported format version ${JSON.stringify(input.formatVersion)}; this app reads version ${CURRENT_FORMAT_VERSION}.`,
        },
      ],
    }
  }

  const errors: ParseError[] = []
  const schema = parseSchema(input.schema, 'schema', (path, message) => {
    errors.push({ path, message })
  })
  if (errors.length > 0 || !schema) return { ok: false, errors }

  return {
    ok: true,
    project: {
      formatVersion: CURRENT_FORMAT_VERSION,
      schema,
      view: input.view ?? null,
    },
  }
}
