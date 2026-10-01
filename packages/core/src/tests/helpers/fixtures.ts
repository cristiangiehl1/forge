import type { Relationship } from '../../schema/types.ts'
import { column, deepFreeze, schemaOf, table } from './schema-builders.ts'

export const usersTable = deepFreeze(
  table(
    'users',
    'users',
    [
      column('u_id', 'id', { kind: 'uuid' }, false),
      column('u_name', 'name', { kind: 'varchar', length: 120 }, false),
    ],
    ['u_id']
  )
)

export const ordersTable = deepFreeze(
  table(
    'orders',
    'orders',
    [
      column('o_id', 'id', { kind: 'uuid' }, false),
      column('o_user', 'user_id', { kind: 'uuid' }, false),
      column('o_total', 'total', { kind: 'numeric', precision: 10, scale: 2 }),
      column('o_created', 'created_at', { kind: 'timestamp' }, false),
    ],
    ['o_id']
  )
)

export const ordersToUsers: Relationship = deepFreeze({
  id: 'fk1',
  from: { tableId: 'orders', columnId: 'o_user' },
  to: { tableId: 'users', columnId: 'u_id' },
})

/** users and orders, with orders.user_id referencing users.id. Deeply frozen. */
export const usersOrders = deepFreeze(
  schemaOf([usersTable, ordersTable], [ordersToUsers])
)
