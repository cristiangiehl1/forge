import { expect, test } from '@playwright/test'

import type { ColumnKind } from '../support/editor.ts'
import { Editor } from '../support/editor.ts'
import { ORDERS_USER_ID, USERS_ID, usersAndOrders } from '../support/small.ts'

test.describe('tables and columns', () => {
  test('a new table is named, placed on the grid and selected', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'New table' }).click()
    await page.getByRole('button', { name: 'New table' }).click()

    await expect(editor.tables()).toHaveCount(2)
    await expect(editor.node('table_1')).toBeVisible()
    await expect(editor.node('table_2')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Table name' })).toHaveValue(
      'table_2'
    )
  })

  test('renaming a table updates the canvas', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.addTable('customers')
    await expect(editor.node('customers')).toBeVisible()
    await expect(editor.node('table_1')).toHaveCount(0)
  })

  test('every logical column type can be chosen', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    const kinds: ColumnKind[] = [
      'integer',
      'bigint',
      'text',
      'boolean',
      'uuid',
      'timestamp',
      'date',
      'json',
    ]
    await editor.defineTable('everything', [
      ...kinds.map((type) => ({ name: `c_${type}`, type })),
      { name: 'c_varchar', type: 'varchar' as const },
      { name: 'c_numeric', type: 'numeric' as const },
    ])

    const node = editor.node('everything')
    for (const type of kinds) {
      await expect(
        node.locator('.table-node__column', { hasText: `c_${type}` })
      ).toContainText(type)
    }
    await expect(node).toContainText('varchar(255)')
    await expect(node).toContainText('numeric(10,2)')
  })

  test('varchar length and numeric precision and scale are editable', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('t', [
      { name: 'code', type: 'varchar', length: 40 },
      { name: 'amount', type: 'numeric', precision: 12, scale: 4 },
    ])
    await expect(editor.node('t')).toContainText('varchar(40)')
    await expect(editor.node('t')).toContainText('numeric(12,4)')
  })

  test('a primary key column is always NOT NULL and shows a PK badge', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('t', [
      { name: 'id', type: 'uuid', primaryKey: true },
    ])

    const notNull = page.getByRole('checkbox', { name: 'NOT NULL' })
    await expect(notNull).toBeChecked()
    await expect(notNull).toBeDisabled()
    await expect(editor.node('t').locator('.table-node__badge')).toHaveText(
      'PK'
    )
  })

  test('deleting a table also removes its relationships', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await usersAndOrders(editor)
    await editor.connect(ORDERS_USER_ID, USERS_ID)

    await editor.selectTable('users')
    await page.getByRole('button', { name: 'Delete table' }).click()

    await expect(editor.tables()).toHaveCount(1)
    await expect(editor.edges()).toHaveCount(0)
  })

  test('removing a column removes the relationship that used it', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await usersAndOrders(editor)
    await editor.connect(ORDERS_USER_ID, USERS_ID)

    await editor.selectTable('orders')
    await page
      .locator('.inspector .column-list')
      .first()
      .locator('.column-row')
      .last()
      .getByRole('button', { name: 'Remove column' })
      .click()

    await expect(editor.edges()).toHaveCount(0)
    await expect(editor.tables()).toHaveCount(2)
  })
})
