import { sameTypeShape, userTypeIdsOf } from './type-shape.ts'
import type {
  Column,
  ColumnId,
  ColumnRef,
  ColumnType,
  IndexId,
  Relationship,
  RelationshipId,
  Schema,
  Table,
  TableId,
  TypeId,
  UserType,
} from './types.ts'
import { GENERATED_COLUMN_KINDS } from './types.ts'

export type IssueCode =
  | 'empty-table-name'
  | 'duplicate-table-name'
  | 'empty-column-name'
  | 'duplicate-column-name'
  | 'generated-unsupported-type'
  | 'generated-with-default'
  | 'empty-index-name'
  | 'duplicate-index-name'
  | 'index-without-columns'
  | 'index-unknown-column'
  | 'index-duplicate-column'
  | 'empty-type-name'
  | 'duplicate-type-name'
  | 'enum-without-values'
  | 'enum-empty-value'
  | 'enum-duplicate-value'
  | 'unknown-type'
  | 'type-cycle'
  | 'name-collision'
  | 'dialect-name-too-long'
  | 'dialect-name-collision'
  | 'dialect-name-invalid'
  | 'dialect-lob-key'
  | 'multiple-relationships-from-column'
  | 'relationship-unknown-column'
  | 'relationship-type-mismatch'
  | 'relationship-target-not-sole-primary-key'

export interface Issue {
  code: IssueCode
  message: string
  tableId?: TableId
  columnId?: ColumnId
  relationshipId?: RelationshipId
  indexId?: IndexId
  typeId?: TypeId
}

type IssueIds = Pick<
  Issue,
  'tableId' | 'columnId' | 'relationshipId' | 'indexId' | 'typeId'
>

function issue(code: IssueCode, message: string, ids: IssueIds = {}): Issue {
  const result: Issue = { code, message }
  if (ids.tableId !== undefined) result.tableId = ids.tableId
  if (ids.columnId !== undefined) result.columnId = ids.columnId
  if (ids.relationshipId !== undefined) {
    result.relationshipId = ids.relationshipId
  }
  if (ids.indexId !== undefined) result.indexId = ids.indexId
  if (ids.typeId !== undefined) result.typeId = ids.typeId
  return result
}

interface Located {
  table: Table
  column: Column
}

function locate(schema: Schema, ref: ColumnRef): Located | null {
  const table = schema.tables.find((candidate) => candidate.id === ref.tableId)
  const column = table?.columns.find(
    (candidate) => candidate.id === ref.columnId
  )
  return table && column ? { table, column } : null
}

const isBlank = (name: string) => name.trim() === ''

/** A type as a person would say it: a user type by its name, arrays with []. */
function describeType(schema: Schema, type: ColumnType): string {
  if (type.kind === 'array') return `${describeType(schema, type.of)}[]`
  if (type.kind === 'user') {
    return (
      schema.types?.find((t) => t.id === type.typeId)?.name ?? 'unknown type'
    )
  }
  return type.kind
}

function relationshipIssue(
  schema: Schema,
  from: ColumnRef,
  to: ColumnRef,
  others: Relationship[],
  relationshipId?: RelationshipId
): Issue | null {
  const source = locate(schema, from)
  const target = locate(schema, to)
  if (!source || !target) {
    return issue(
      'relationship-unknown-column',
      'A relationship points to a table or column that does not exist.',
      relationshipId === undefined ? {} : { relationshipId }
    )
  }

  const ids: IssueIds = {
    tableId: from.tableId,
    columnId: from.columnId,
    ...(relationshipId === undefined ? {} : { relationshipId }),
  }
  const sourceName = `${source.table.name}.${source.column.name}`
  const targetName = `${target.table.name}.${target.column.name}`

  const alreadySource = others.some(
    (other) =>
      other.from.tableId === from.tableId &&
      other.from.columnId === from.columnId
  )
  if (alreadySource) {
    return issue(
      'multiple-relationships-from-column',
      `Column "${sourceName}" is the source of more than one relationship.`,
      ids
    )
  }

  if (!sameTypeShape(source.column.type, target.column.type)) {
    return issue(
      'relationship-type-mismatch',
      `Column "${sourceName}" (${describeType(schema, source.column.type)}) cannot reference "${targetName}" (${describeType(schema, target.column.type)}): the types differ.`,
      ids
    )
  }

  const primaryKey = target.table.primaryKey
  if (primaryKey.length !== 1 || primaryKey[0] !== target.column.id) {
    return issue(
      'relationship-target-not-sole-primary-key',
      `Column "${targetName}" cannot be referenced: it is not the sole primary key of its table.`,
      ids
    )
  }

  return null
}

/**
 * The issue that adding `from` → `to` would cause, or null when it is allowed.
 * A `from` column that already has a relationship in `schema` is an issue.
 */
export function checkRelationship(
  schema: Schema,
  from: ColumnRef,
  to: ColumnRef
): Issue | null {
  return relationshipIssue(schema, from, to, schema.relationships)
}

export function validate(schema: Schema): Issue[] {
  const issues: Issue[] = []
  const types = schema.types ?? []
  const typeIds = new Set(types.map((type) => type.id))
  const seenIndexNames = new Set<string>()

  const seenTables = new Set<string>()
  for (const table of schema.tables) {
    if (isBlank(table.name)) {
      issues.push(
        issue('empty-table-name', 'A table has an empty name.', {
          tableId: table.id,
        })
      )
    } else if (seenTables.has(table.name)) {
      issues.push(
        issue(
          'duplicate-table-name',
          `Table name "${table.name}" is used more than once.`,
          { tableId: table.id }
        )
      )
    }
    seenTables.add(table.name)

    const seenColumns = new Set<string>()
    for (const column of table.columns) {
      const ids = { tableId: table.id, columnId: column.id }
      if (isBlank(column.name)) {
        issues.push(
          issue(
            'empty-column-name',
            `A column in table "${table.name}" has an empty name.`,
            ids
          )
        )
      } else if (seenColumns.has(column.name)) {
        issues.push(
          issue(
            'duplicate-column-name',
            `Column name "${column.name}" is used more than once in table "${table.name}".`,
            ids
          )
        )
      }
      seenColumns.add(column.name)

      if (
        column.generated &&
        !(GENERATED_COLUMN_KINDS as readonly string[]).includes(
          column.type.kind
        )
      ) {
        issues.push(
          issue(
            'generated-unsupported-type',
            `Column "${table.name}.${column.name}" cannot be generated: only integer, bigint, uuid and timestamp columns can.`,
            ids
          )
        )
      }

      if (column.generated && (column.default ?? '').trim() !== '') {
        issues.push(
          issue(
            'generated-with-default',
            `Column "${table.name}.${column.name}" is generated and also has a default: choose one.`,
            ids
          )
        )
      }
      if (userTypeIdsOf(column.type).some((id) => !typeIds.has(id))) {
        issues.push(
          issue(
            'unknown-type',
            `Column "${table.name}.${column.name}" uses a type that does not exist.`,
            ids
          )
        )
      }
    }
    for (const index of table.indexes ?? []) {
      const ids = { tableId: table.id, indexId: index.id }
      if (isBlank(index.name)) {
        issues.push(
          issue(
            'empty-index-name',
            `An index on table "${table.name}" has an empty name.`,
            ids
          )
        )
      } else if (seenIndexNames.has(index.name)) {
        issues.push(
          issue(
            'duplicate-index-name',
            `Index name "${index.name}" is used more than once.`,
            ids
          )
        )
      }
      seenIndexNames.add(index.name)
      if (index.columns.length === 0) {
        issues.push(
          issue(
            'index-without-columns',
            `Index "${index.name}" has no columns.`,
            ids
          )
        )
      }
      const used = new Set<string>()
      for (const columnId of index.columns) {
        if (!table.columns.some((column) => column.id === columnId)) {
          issues.push(
            issue(
              'index-unknown-column',
              `Index "${index.name}" uses a column that does not exist.`,
              ids
            )
          )
        } else if (used.has(columnId)) {
          issues.push(
            issue(
              'index-duplicate-column',
              `Index "${index.name}" uses a column twice.`,
              ids
            )
          )
        }
        used.add(columnId)
      }
    }
  }

  for (const relationship of schema.relationships) {
    const found = relationshipIssue(
      schema,
      relationship.from,
      relationship.to,
      schema.relationships.filter((other) => other.id !== relationship.id),
      relationship.id
    )
    if (found) issues.push(found)
  }

  // A domain is in a cycle when following its base types leads back to it.
  const inCycle = (start: UserType): boolean => {
    const visited = new Set<string>()
    const queue = [start]
    while (queue.length > 0) {
      const current = queue.pop()
      if (current?.kind !== 'domain') continue
      for (const id of userTypeIdsOf(current.base)) {
        if (id === start.id) return true
        if (visited.has(id)) continue
        visited.add(id)
        const next = types.find((candidate) => candidate.id === id)
        if (next) queue.push(next)
      }
    }
    return false
  }

  // Tables, indexes and types of PostgreSQL share names: a table has a row type,
  // and an index is a relation like a table.
  const tableNames = new Set(schema.tables.map((table) => table.name))
  for (const table of schema.tables) {
    for (const index of table.indexes ?? []) {
      if (tableNames.has(index.name)) {
        issues.push(
          issue(
            'name-collision',
            `Index "${index.name}" has the name of a table.`,
            { tableId: table.id, indexId: index.id }
          )
        )
      }
    }
  }

  const seenTypeNames = new Set<string>()
  for (const userType of types) {
    const ids = { typeId: userType.id }
    if (isBlank(userType.name)) {
      issues.push(issue('empty-type-name', 'A type has an empty name.', ids))
    } else if (seenTypeNames.has(userType.name)) {
      issues.push(
        issue(
          'duplicate-type-name',
          `Type name "${userType.name}" is used more than once.`,
          ids
        )
      )
    }
    if (tableNames.has(userType.name)) {
      issues.push(
        issue(
          'name-collision',
          `Type "${userType.name}" has the name of a table.`,
          ids
        )
      )
    }
    seenTypeNames.add(userType.name)
    if (userType.kind === 'enum') {
      if (userType.values.length === 0) {
        issues.push(
          issue(
            'enum-without-values',
            `Enum "${userType.name}" has no values.`,
            ids
          )
        )
      }
      const seenValues = new Set<string>()
      for (const value of userType.values) {
        if (value === '') {
          issues.push(
            issue(
              'enum-empty-value',
              `Enum "${userType.name}" has an empty value.`,
              ids
            )
          )
        } else if (seenValues.has(value)) {
          issues.push(
            issue(
              'enum-duplicate-value',
              `Enum "${userType.name}" repeats the value "${value}".`,
              ids
            )
          )
        }
        seenValues.add(value)
      }
    } else if (inCycle(userType)) {
      issues.push(
        issue(
          'type-cycle',
          `Domain "${userType.name}" is based on itself, directly or through other domains.`,
          ids
        )
      )
    } else if (userTypeIdsOf(userType.base).some((id) => !typeIds.has(id))) {
      issues.push(
        issue(
          'unknown-type',
          `Domain "${userType.name}" is based on a type that does not exist.`,
          ids
        )
      )
    }
  }

  return issues
}
