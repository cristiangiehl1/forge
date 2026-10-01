import type { Editor } from './editor.ts'

/** users(id uuid pk, name) and orders(id uuid pk, user_id uuid), not related yet. */
export async function usersAndOrders(editor: Editor) {
  await editor.defineTable('users', [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'name', type: 'text' },
  ])
  await editor.defineTable('orders', [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'user_id', type: 'uuid' },
  ])
}

export const ORDERS_USER_ID = { table: 'orders', column: 'user_id' }
export const USERS_ID = { table: 'users', column: 'id' }
