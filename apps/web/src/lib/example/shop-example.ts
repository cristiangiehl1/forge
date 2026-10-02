import type { ColumnType, Schema } from '@forge/core'
import * as core from '@forge/core'

import { layoutTables } from '../layout/layout-tables.ts'
import type { ProjectView } from '../project-view.ts'
import { createView } from '../project-view.ts'

/**
 * A small online shop to look at: seven tables and eight foreign keys, built with
 * the core's own operations, so it is exactly what a person could have drawn.
 * Ids are fixed, which keeps it deterministic and easy to test. Where the tables sit
 * is not stored here: `layoutTables` works it out from the relationships.
 */
interface ColumnDef {
  name: string
  type: ColumnType
  notNull?: boolean
  generated?: boolean
  primaryKey?: boolean
}

interface TableDef {
  name: string
  columns: ColumnDef[]
}

const integer: ColumnType = { kind: 'integer' }
const varchar = (length: number): ColumnType => ({ kind: 'varchar', length })
const money = (precision: number): ColumnType => ({
  kind: 'numeric',
  precision,
  scale: 2,
})

/** The id a new table gets by default: a generated integer primary key. */
const id = (): ColumnDef => ({
  name: 'id',
  type: integer,
  generated: true,
  primaryKey: true,
})

/** What the timestamps preference gives a new table: DEFAULT now(), required. */
const timestamps = (): ColumnDef[] =>
  ['created_at', 'updated_at'].map((name) => ({
    name,
    type: { kind: 'timestamp' },
    notNull: true,
    generated: true,
  }))

const TABLES: TableDef[] = [
  {
    name: 'users',
    columns: [
      id(),
      { name: 'name', type: varchar(120), notNull: true },
      { name: 'email', type: varchar(255), notNull: true },
      ...timestamps(),
    ],
  },
  {
    name: 'addresses',
    columns: [
      id(),
      { name: 'user_id', type: integer, notNull: true },
      { name: 'street', type: varchar(200), notNull: true },
      { name: 'city', type: varchar(100), notNull: true },
      { name: 'country', type: varchar(2) },
    ],
  },
  {
    name: 'categories',
    columns: [id(), { name: 'name', type: varchar(80), notNull: true }],
  },
  {
    name: 'orders',
    columns: [
      id(),
      { name: 'user_id', type: integer, notNull: true },
      { name: 'address_id', type: integer },
      { name: 'status', type: varchar(20), notNull: true },
      { name: 'total', type: money(12) },
      ...timestamps(),
    ],
  },
  {
    name: 'order_items',
    columns: [
      { name: 'order_id', type: integer, primaryKey: true },
      { name: 'product_id', type: integer, primaryKey: true },
      { name: 'quantity', type: integer, notNull: true },
      { name: 'unit_price', type: money(10), notNull: true },
    ],
  },
  {
    name: 'products',
    columns: [
      id(),
      { name: 'category_id', type: integer },
      { name: 'name', type: varchar(160), notNull: true },
      { name: 'price', type: money(10), notNull: true },
      { name: 'active', type: { kind: 'boolean' }, notNull: true },
    ],
  },
  {
    name: 'reviews',
    columns: [
      id(),
      { name: 'product_id', type: integer, notNull: true },
      { name: 'user_id', type: integer, notNull: true },
      { name: 'rating', type: integer, notNull: true },
      { name: 'body', type: { kind: 'text' } },
    ],
  },
]

/** [table, column, referenced table]: every one references the `id` of its target. */
const FOREIGN_KEYS: [string, string, string][] = [
  ['addresses', 'user_id', 'users'],
  ['products', 'category_id', 'categories'],
  ['orders', 'user_id', 'users'],
  ['orders', 'address_id', 'addresses'],
  ['order_items', 'order_id', 'orders'],
  ['order_items', 'product_id', 'products'],
  ['reviews', 'product_id', 'products'],
  ['reviews', 'user_id', 'users'],
]

const tableId = (table: string) => `ex-t-${table}`
const columnId = (table: string, column: string) => `ex-c-${table}-${column}`

export function createShopExample(): { schema: Schema; view: ProjectView } {
  let schema = core.createSchema()

  for (const table of TABLES) {
    schema = core.addTable(schema, {
      id: tableId(table.name),
      name: table.name,
    })
    for (const column of table.columns) {
      schema = core.addColumn(schema, tableId(table.name), {
        id: columnId(table.name, column.name),
        name: column.name,
        type: column.type,
        nullable: !(column.notNull || column.primaryKey),
        ...(column.generated ? { generated: true } : {}),
      })
    }
    schema = core.setPrimaryKey(
      schema,
      tableId(table.name),
      table.columns
        .filter((column) => column.primaryKey)
        .map((column) => columnId(table.name, column.name))
    )
  }

  for (const [from, column, to] of FOREIGN_KEYS) {
    schema = core.addRelationship(schema, {
      id: `ex-r-${from}-${column}`,
      from: { tableId: tableId(from), columnId: columnId(from, column) },
      to: { tableId: tableId(to), columnId: columnId(to, 'id') },
    })
  }

  return { schema, view: { ...createView(), nodes: layoutTables(schema) } }
}
