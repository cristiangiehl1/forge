import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'
import { buildShop, SHOP_DDL } from '../support/shop.ts'

test.describe('the DDL panel', () => {
  test('asks for a table when the project is empty', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.showDdl()
    await expect(editor.ddlPanel()).toContainText(
      'Add a table to generate the DDL'
    )
  })

  test('shows an empty table as CREATE TABLE with no columns', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.addTable('empty')
    expect(await editor.ddl()).toBe('CREATE TABLE "empty" ();\n')
  })

  test('quotes and escapes names, and keeps their case', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('Weird "Name"', [{ name: 'my col' }])
    expect(await editor.ddl()).toBe(
      'CREATE TABLE "Weird ""Name""" (\n  "my col" text\n);\n'
    )
  })

  test('lists the problems instead of the SQL while the schema is invalid', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.addTable('users')
    await page.getByRole('button', { name: 'New table' }).click()
    await page.getByRole('textbox', { name: 'Table name' }).fill('users')

    await editor.showDdl()
    await expect(editor.ddlPanel()).toContainText(
      'Table name "users" is used more than once.'
    )
    await expect(page.locator('.ddl-panel pre')).toHaveCount(0)

    await page.getByRole('textbox', { name: 'Table name' }).fill('orders')
    await expect(page.locator('.ddl-panel pre')).toBeVisible()
  })

  test('produces the expected script for a six-table shop', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await buildShop(editor)
    expect(await editor.ddl()).toBe(SHOP_DDL)
  })
})
