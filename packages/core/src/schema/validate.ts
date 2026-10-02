import type {
  Column,
  ColumnId,
  ColumnRef,
  Relationship,
  RelationshipId,
  Schema,
  Table,
  TableId,
} from './types.ts'
import { GENERATED_COLUMN_KINDS } from './types.ts'

export type IssueCode =
  | 'empty-table-name'
  | 'duplicate-table-name'
  | 'empty-column-name'
  | 'duplicate-column-name'
  | 'generated-unsupported-type'
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
}

type IssueIds = Pick<Issue, 'tableId' | 'columnId' | 'relationshipId'>

function issue(code: IssueCode, message: string, ids: IssueIds = {}): Issue {
  const result: Issue = { code, message }
  if (ids.tableId !== undefined) result.tableId = ids.tableId
  if (ids.columnId !== undefined) result.columnId = ids.columnId
  if (ids.relationshipId !== undefined) {
    result.relationshipId = ids.relationshipId
  }
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

  if (source.column.type.kind !== target.column.type.kind) {
    return issue(
      'relationship-type-mismatch',
      `Column "${sourceName}" (${source.column.type.kind}) cannot reference "${targetName}" (${target.column.type.kind}): the types differ.`,
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

  return issues
}
