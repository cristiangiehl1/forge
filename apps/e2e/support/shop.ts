import type { ColumnRef, ColumnSpec, Editor } from './editor.ts'

/**
 * A small online shop: six tables, six foreign keys. Tables are placed by the
 * app on a three-column grid, so this order is also the layout:
 *
 *   users        categories   products
 *   orders       order_items  reviews
 */
export interface TableSpec {
  name: string
  columns: ColumnSpec[]
}

export const SHOP_TABLES: TableSpec[] = [
  {
    name: 'users',
    columns: [
      { name: 'id', type: 'uuid', primaryKey: true },
      { name: 'name', type: 'varchar', length: 120, notNull: true },
      { name: 'email', type: 'varchar', length: 255, notNull: true },
    ],
  },
  {
    name: 'categories',
    columns: [
      { name: 'id', type: 'uuid', primaryKey: true },
      { name: 'name', type: 'varchar', length: 80, notNull: true },
    ],
  },
  {
    name: 'products',
    columns: [
      { name: 'id', type: 'uuid', primaryKey: true },
      { name: 'category_id', type: 'uuid' },
      { name: 'name', type: 'varchar', length: 160, notNull: true },
      { name: 'price', type: 'numeric', notNull: true },
    ],
  },
  {
    name: 'orders',
    columns: [
      { name: 'id', type: 'uuid', primaryKey: true },
      { name: 'user_id', type: 'uuid', notNull: true },
      { name: 'created_at', type: 'timestamp', notNull: true },
      { name: 'total', type: 'numeric', precision: 12, scale: 2 },
    ],
  },
  {
    name: 'order_items',
    columns: [
      { name: 'order_id', type: 'uuid', primaryKey: true },
      { name: 'product_id', type: 'uuid', primaryKey: true },
      { name: 'quantity', type: 'integer', notNull: true },
    ],
  },
  {
    name: 'reviews',
    columns: [
      { name: 'id', type: 'uuid', primaryKey: true },
      { name: 'product_id', type: 'uuid', notNull: true },
      { name: 'user_id', type: 'uuid', notNull: true },
      { name: 'rating', type: 'integer', notNull: true },
      { name: 'body', type: 'text' },
    ],
  },
]

export interface ForeignKey {
  from: ColumnRef
  to: ColumnRef
}

const fk = (
  fromTable: string,
  fromColumn: string,
  toTable: string,
  toColumn = 'id'
): ForeignKey => ({
  from: { table: fromTable, column: fromColumn },
  to: { table: toTable, column: toColumn },
})

export const SHOP_FOREIGN_KEYS: ForeignKey[] = [
  fk('products', 'category_id', 'categories'),
  fk('orders', 'user_id', 'users'),
  fk('order_items', 'order_id', 'orders'),
  fk('order_items', 'product_id', 'products'),
  fk('reviews', 'product_id', 'products'),
  fk('reviews', 'user_id', 'users'),
]

export async function buildShopTables(editor: Editor) {
  for (const table of SHOP_TABLES) {
    await editor.defineTable(table.name, table.columns)
  }
}

export async function buildShopForeignKeys(editor: Editor) {
  for (const { from, to } of SHOP_FOREIGN_KEYS) {
    await editor.connect(from, to)
  }
}

export async function buildShop(editor: Editor) {
  await buildShopTables(editor)
  await buildShopForeignKeys(editor)
}

/** The DDL the shop must produce, statement by statement. */
export const SHOP_DDL = [
  [
    'CREATE TABLE "users" (',
    '  "id" uuid NOT NULL,',
    '  "name" varchar(120) NOT NULL,',
    '  "email" varchar(255) NOT NULL,',
    '  PRIMARY KEY ("id")',
    ');',
  ],
  [
    'CREATE TABLE "categories" (',
    '  "id" uuid NOT NULL,',
    '  "name" varchar(80) NOT NULL,',
    '  PRIMARY KEY ("id")',
    ');',
  ],
  [
    'CREATE TABLE "products" (',
    '  "id" uuid NOT NULL,',
    '  "category_id" uuid,',
    '  "name" varchar(160) NOT NULL,',
    '  "price" numeric(10,2) NOT NULL,',
    '  PRIMARY KEY ("id")',
    ');',
  ],
  [
    'CREATE TABLE "orders" (',
    '  "id" uuid NOT NULL,',
    '  "user_id" uuid NOT NULL,',
    '  "created_at" timestamptz NOT NULL,',
    '  "total" numeric(12,2),',
    '  PRIMARY KEY ("id")',
    ');',
  ],
  [
    'CREATE TABLE "order_items" (',
    '  "order_id" uuid NOT NULL,',
    '  "product_id" uuid NOT NULL,',
    '  "quantity" integer NOT NULL,',
    '  PRIMARY KEY ("order_id", "product_id")',
    ');',
  ],
  [
    'CREATE TABLE "reviews" (',
    '  "id" uuid NOT NULL,',
    '  "product_id" uuid NOT NULL,',
    '  "user_id" uuid NOT NULL,',
    '  "rating" integer NOT NULL,',
    '  "body" text,',
    '  PRIMARY KEY ("id")',
    ');',
  ],
  ...SHOP_FOREIGN_KEYS.map(({ from, to }) => [
    `ALTER TABLE "${from.table}"`,
    `  ADD CONSTRAINT "fk_${from.table}_${from.column}"`,
    `  FOREIGN KEY ("${from.column}") REFERENCES "${to.table}" ("${to.column}");`,
  ]),
]
  .map((statement) => statement.join('\n'))
  .join('\n\n')
  .concat('\n')
