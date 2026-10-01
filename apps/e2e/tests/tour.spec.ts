import { mkdirSync } from 'node:fs'
import path from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'
import {
  buildShopForeignKeys,
  buildShopTables,
  SHOP_DDL,
  SHOP_FOREIGN_KEYS,
  SHOP_TABLES,
} from '../support/shop.ts'

/**
 * A guided tour of the system as it is today, meant to be watched:
 *
 *   pnpm e2e:tour    opens a browser and runs it slowly
 *   pnpm e2e:ui      step through it in Playwright's UI mode
 *
 * Every step saves a screenshot in apps/e2e/screenshots/.
 */
const SHOTS = path.resolve(import.meta.dirname, '../screenshots')
const PAUSE_MS = Number(process.env.PAUSE ?? 0)

let shotNumber = 0

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true })
  shotNumber += 1
  const file = path.join(
    SHOTS,
    `${String(shotNumber).padStart(2, '0')}-${name}.png`
  )
  await page.screenshot({ path: file })
  await test.info().attach(name, { path: file, contentType: 'image/png' })
  if (PAUSE_MS > 0) await page.waitForTimeout(PAUSE_MS)
}

test('guided tour: an online shop with six tables and six foreign keys', async ({
  page,
}) => {
  const editor = new Editor(page)

  await test.step('Open the editor: it starts empty', async () => {
    await editor.open()
    await expect(editor.tables()).toHaveCount(0)
    await shot(page, 'empty-editor')
  })

  await test.step('Choose what a new table starts with: a generated uuid id', async () => {
    await editor.chooseNewTableId('uuid')
    await expect(editor.newTableIdSelect()).toHaveValue('uuid')
    await shot(page, 'new-table-id-setting')
  })

  await test.step('Create six tables with their columns', async () => {
    await buildShopTables(editor)
    await expect(editor.tables()).toHaveCount(SHOP_TABLES.length)
    await expect(editor.edges()).toHaveCount(0)
    await shot(page, 'six-tables')
  })

  await test.step('Relate them: drag from a column to the one it references', async () => {
    await buildShopForeignKeys(editor)
    await expect(editor.edges()).toHaveCount(SHOP_FOREIGN_KEYS.length)
    await shot(page, 'six-foreign-keys')
  })

  await test.step('Read the PostgreSQL DDL the drawing produces', async () => {
    expect(await editor.ddl()).toBe(SHOP_DDL)
    await shot(page, 'generated-ddl')
  })

  await test.step('Select a table to see and edit it in the inspector', async () => {
    await editor.selectTable('orders')
    await expect(page.locator('.inspector .relationship-label')).toHaveText([
      'orders.user_id → users.id',
      'order_items.order_id → orders.id',
    ])
    await shot(page, 'inspector-orders')
  })

  await test.step('Click a relationship line to select it', async () => {
    // Relationships are drawn in creation order: the second one is orders → users.
    await editor.clickRelationship(1)
    await expect(editor.removeButton()).toBeVisible()
    await shot(page, 'relationship-selected')
  })

  await test.step('Remove it with the button on the line', async () => {
    await editor.removeButton().click()
    await expect(editor.edges()).toHaveCount(SHOP_FOREIGN_KEYS.length - 1)
    await expect(editor.tables()).toHaveCount(SHOP_TABLES.length)
    expect(await editor.ddl()).not.toContain('fk_orders_user_id')
    await shot(page, 'relationship-removed')
  })

  await test.step('Put it back by dragging again', async () => {
    await editor.connect(
      { table: 'orders', column: 'user_id' },
      { table: 'users', column: 'id' }
    )
    await expect(editor.edges()).toHaveCount(SHOP_FOREIGN_KEYS.length)
    await shot(page, 'relationship-restored')
  })

  await test.step('Reload the page: the project is still there', async () => {
    // The project is autosaved half a second after the last change.
    await page.waitForTimeout(800)
    await page.reload()
    await expect(editor.tables()).toHaveCount(SHOP_TABLES.length)
    await expect(editor.edges()).toHaveCount(SHOP_FOREIGN_KEYS.length)
    await shot(page, 'after-reload')
  })
})
