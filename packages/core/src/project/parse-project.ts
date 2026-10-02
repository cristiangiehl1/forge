import type { DialectId, DialectOptions } from '../dialects/dialect.ts'
import { DIALECT_IDS } from '../dialects/dialect.ts'
import type {
  Column,
  ColumnType,
  Index,
  IndexMethod,
  Relationship,
  Schema,
  SimpleColumnKind,
  Table,
  UserType,
} from '../schema/types.ts'
import {
  INDEX_METHODS,
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

function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fail: Fail
): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    fail(`${path}.${key}`, `"${key}" must be a string.`)
    return undefined
  }
  return value
}

function parseType(
  raw: unknown,
  path: string,
  fail: Fail,
  typeIds?: ReadonlySet<string>
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
  if (kind === 'char') {
    const length = raw.length
    if (!isInteger(length) || length < 1 || length > MAX_VARCHAR_LENGTH) {
      fail(
        path,
        `char needs an integer length from 1 to ${MAX_VARCHAR_LENGTH}.`
      )
      return undefined
    }
    return { kind: 'char', length }
  }
  if (kind === 'array') {
    const of = parseType(raw.of, `${path}.of`, fail, typeIds)
    return of ? { kind: 'array', of } : undefined
  }
  if (kind === 'user') {
    if (typeof raw.typeId !== 'string') {
      fail(`${path}.typeId`, 'A user type needs a "typeId".')
      return undefined
    }
    if (typeIds && !typeIds.has(raw.typeId)) {
      fail(`${path}.typeId`, `The type "${raw.typeId}" does not exist.`)
      return undefined
    }
    return { kind: 'user', typeId: raw.typeId }
  }
  fail(path, `Unknown column type "${kind}".`)
  return undefined
}

function parseColumn(
  raw: unknown,
  path: string,
  fail: Fail,
  typeIds: ReadonlySet<string>
): Column | undefined {
  if (!isRecord(raw)) {
    fail(path, 'A column must be an object.')
    return undefined
  }
  const id = readString(raw, 'id', path, fail)
  const name = readString(raw, 'name', path, fail)
  const type = parseType(raw.type, `${path}.type`, fail, typeIds)
  const comment = readOptionalString(raw, 'comment', path, fail)
  const dflt = readOptionalString(raw, 'default', path, fail)
  const generatedIsValid =
    raw.generated === undefined || typeof raw.generated === 'boolean'
  if (!generatedIsValid) {
    fail(`${path}.generated`, '"generated" must be a boolean.')
  }
  if (typeof raw.nullable !== 'boolean') {
    fail(`${path}.nullable`, '"nullable" must be a boolean.')
    return undefined
  }
  if (
    id === undefined ||
    name === undefined ||
    type === undefined ||
    !generatedIsValid ||
    (raw.comment !== undefined && comment === undefined) ||
    (raw.default !== undefined && dflt === undefined)
  ) {
    return undefined
  }
  return {
    id,
    name,
    type,
    nullable: raw.nullable,
    ...(typeof raw.generated === 'boolean' ? { generated: raw.generated } : {}),
    ...(dflt === undefined ? {} : { default: dflt }),
    ...(comment === undefined ? {} : { comment }),
  }
}

function parseTable(
  raw: unknown,
  path: string,
  fail: Fail,
  typeIds: ReadonlySet<string>,
  indexIds: Set<string>
): Table | undefined {
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
    const column = parseColumn(rawColumn, columnPath, fail, typeIds)
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

  const comment = readOptionalString(raw, 'comment', path, fail)
  const indexes = parseIndexes(
    raw.indexes,
    `${path}.indexes`,
    columnIds,
    indexIds,
    fail
  )

  if (id === undefined || name === undefined) return undefined
  return {
    id,
    name,
    columns,
    primaryKey,
    ...(comment === undefined ? {} : { comment }),
    ...(indexes ? { indexes } : {}),
  }
}

function parseIndexes(
  raw: unknown,
  path: string,
  columnIds: ReadonlySet<string>,
  indexIds: Set<string>,
  fail: Fail
): Index[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    fail(path, '"indexes" must be an array.')
    return undefined
  }
  const indexes: Index[] = []
  raw.forEach((rawIndex: unknown, position: number) => {
    const indexPath = `${path}[${position}]`
    if (!isRecord(rawIndex)) {
      fail(indexPath, 'An index must be an object.')
      return
    }
    const id = readString(rawIndex, 'id', indexPath, fail)
    if (id !== undefined && indexIds.has(id)) {
      fail(`${indexPath}.id`, `Duplicate index id "${id}".`)
      return
    }
    if (id !== undefined) indexIds.add(id)
    const name = readString(rawIndex, 'name', indexPath, fail)
    const columns: string[] = []
    if (!Array.isArray(rawIndex.columns)) {
      fail(`${indexPath}.columns`, '"columns" must be an array.')
    } else {
      rawIndex.columns.forEach((entry: unknown, at: number) => {
        if (typeof entry !== 'string' || !columnIds.has(entry)) {
          fail(
            `${indexPath}.columns[${at}]`,
            'An index column must be the id of a column of the table.'
          )
          return
        }
        columns.push(entry)
      })
    }
    if (typeof rawIndex.unique !== 'boolean') {
      fail(`${indexPath}.unique`, '"unique" must be a boolean.')
    }
    const method = rawIndex.method
    if (!(INDEX_METHODS as readonly unknown[]).includes(method)) {
      fail(
        `${indexPath}.method`,
        `"method" must be one of ${INDEX_METHODS.join(', ')}.`
      )
    }
    if (
      id === undefined ||
      name === undefined ||
      typeof rawIndex.unique !== 'boolean' ||
      !(INDEX_METHODS as readonly unknown[]).includes(method)
    ) {
      return
    }
    indexes.push({
      id,
      name,
      columns,
      unique: rawIndex.unique,
      method: method as IndexMethod,
    })
  })
  return indexes
}

function parseTypes(
  raw: unknown,
  path: string,
  typeIds: ReadonlySet<string>,
  fail: Fail
): UserType[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    fail(path, '"types" must be an array.')
    return undefined
  }
  const types: UserType[] = []
  const seenIds = new Set<string>()
  raw.forEach((rawType: unknown, position: number) => {
    const typePath = `${path}[${position}]`
    if (!isRecord(rawType)) {
      fail(typePath, 'A type must be an object.')
      return
    }
    const id = readString(rawType, 'id', typePath, fail)
    if (id !== undefined && seenIds.has(id)) {
      fail(`${typePath}.id`, `Duplicate type id "${id}".`)
      return
    }
    if (id !== undefined) seenIds.add(id)
    const name = readString(rawType, 'name', typePath, fail)
    if (rawType.kind === 'enum') {
      if (!Array.isArray(rawType.values)) {
        fail(`${typePath}.values`, '"values" must be an array.')
        return
      }
      const values: string[] = []
      let valuesAreValid = true
      rawType.values.forEach((value: unknown, at: number) => {
        if (typeof value !== 'string') {
          fail(`${typePath}.values[${at}]`, 'An enum value must be a string.')
          valuesAreValid = false
          return
        }
        values.push(value)
      })
      if (id === undefined || name === undefined || !valuesAreValid) return
      types.push({ kind: 'enum', id, name, values })
      return
    }
    if (rawType.kind === 'domain') {
      const base = parseType(rawType.base, `${typePath}.base`, fail, typeIds)
      const dflt = readOptionalString(rawType, 'default', typePath, fail)
      if (
        rawType.notNull !== undefined &&
        typeof rawType.notNull !== 'boolean'
      ) {
        fail(`${typePath}.notNull`, '"notNull" must be a boolean.')
        return
      }
      if (
        id === undefined ||
        name === undefined ||
        !base ||
        (rawType.default !== undefined && dflt === undefined)
      ) {
        return
      }
      types.push({
        kind: 'domain',
        id,
        name,
        base,
        ...(typeof rawType.notNull === 'boolean'
          ? { notNull: rawType.notNull }
          : {}),
        ...(dflt === undefined ? {} : { default: dflt }),
      })
      return
    }
    fail(`${typePath}.kind`, 'A type must be an "enum" or a "domain".')
  })
  return types
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

  const typeIds = new Set<string>()
  if (Array.isArray(raw.types)) {
    for (const rawType of raw.types) {
      if (isRecord(rawType) && typeof rawType.id === 'string') {
        typeIds.add(rawType.id)
      }
    }
  }
  const types = parseTypes(raw.types, `${path}.types`, typeIds, fail)

  const indexIds = new Set<string>()
  const tables: Table[] = []
  const tableIds = new Set<string>()
  raw.tables.forEach((rawTable: unknown, index: number) => {
    const tablePath = `${path}.tables[${index}]`
    const table = parseTable(rawTable, tablePath, fail, typeIds, indexIds)
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

  return {
    version: 1,
    tables,
    relationships,
    ...(types ? { types } : {}),
  }
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

  let dialect: DialectId | undefined
  if (input.dialect !== undefined) {
    if (
      typeof input.dialect === 'string' &&
      (DIALECT_IDS as readonly string[]).includes(input.dialect)
    ) {
      dialect = input.dialect as DialectId
    } else {
      errors.push({
        path: 'dialect',
        message: `"dialect" must be one of ${DIALECT_IDS.join(', ')}.`,
      })
    }
  }

  const options: DialectOptions = {}
  if (input.options !== undefined) {
    if (!isRecord(input.options)) {
      errors.push({ path: 'options', message: '"options" must be an object.' })
    } else if (input.options.uuid !== undefined) {
      if (
        input.options.uuid === 'raw16' ||
        input.options.uuid === 'varchar36'
      ) {
        options.uuid = input.options.uuid
      } else {
        errors.push({
          path: 'options.uuid',
          message: '"uuid" must be "raw16" or "varchar36".',
        })
      }
    }
  }

  if (errors.length > 0 || !schema) return { ok: false, errors }

  return {
    ok: true,
    project: {
      formatVersion: CURRENT_FORMAT_VERSION,
      schema,
      view: input.view ?? null,
      ...(dialect === undefined ? {} : { dialect }),
      ...(Object.keys(options).length > 0 ? { options } : {}),
    },
  }
}
