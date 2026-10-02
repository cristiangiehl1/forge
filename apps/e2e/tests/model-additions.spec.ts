import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

async function exampleLoaded(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 })
  const editor = new Editor(page)
  await editor.open()
  await page.getByRole('button', { name: 'Load example' }).click()
  await expect(editor.tables()).toHaveCount(7)
  return editor
}

test.describe('comments, indexes, defaults and types', () => {
  test('a commented column shows an icon, and hovering it shows the comment', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    const row = editor
      .node('users')
      .locator('.table-node__column', { hasText: 'email' })
    await row.getByRole('button', { name: 'Show column comment' }).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Login address, unique')
    await page.mouse.move(5, 300)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  })

  test('a commented table shows the icon in its title', async ({ page }) => {
    const editor = await exampleLoaded(page)
    await editor
      .node('users')
      .getByRole('button', { name: 'Show table comment' })
      .hover()
    await expect(page.getByRole('tooltip')).toHaveText(
      'People who can place orders'
    )
  })

  test('the node keeps its fixed size with comments and a UQ badge', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    const size = await editor
      .node('users')
      .locator('.table-node')
      .evaluate((element) => ({
        w: (element as HTMLElement).offsetWidth,
        h: (element as HTMLElement).offsetHeight,
        rows: element.querySelectorAll('.table-node__column').length,
      }))
    expect(size.w).toBe(220)
    expect(size.h).toBe(33 + 26 * size.rows)
    await expect(
      editor.node('users').locator('.table-node__badge', { hasText: 'UQ' })
    ).toHaveCount(1)
  })

  test('the Inspector sets a table comment, and the DDL gets COMMENT ON', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    await editor.selectTable('categories')
    await page
      .getByLabel('Table comment', { exact: true })
      .fill('Product groups')
    await expect(
      editor
        .node('categories')
        .getByRole('button', { name: 'Show table comment' })
    ).toBeVisible()
    expect(await editor.ddl()).toContain(
      `COMMENT ON TABLE "categories" IS 'Product groups';`
    )
  })

  test('adding an index from the Inspector puts CREATE INDEX in the DDL, and it can be made unique and removed', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    await editor.selectTable('categories')
    await page.getByRole('button', { name: 'Add index' }).click()
    expect(await editor.ddl()).toContain(
      'CREATE INDEX "idx_categories_id" ON "categories" ("id");'
    )

    await page.getByLabel('Index unique').check()
    expect(await editor.ddl()).toContain(
      'CREATE UNIQUE INDEX "idx_categories_id" ON "categories" ("id");'
    )

    await page.getByRole('button', { name: 'Remove index' }).click()
    await page.getByRole('button', { name: 'Click again to delete' }).click()
    expect(await editor.ddl()).not.toContain('idx_categories_id')
  })

  test('hovering a table also lights its CREATE INDEX statement', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    await editor.showDdl()
    await editor.node('orders').locator('.table-node__title').hover()
    const active = page.locator('.ddl-active')
    await expect(
      active.filter({ hasText: 'CREATE INDEX "idx_orders_user_id"' })
    ).toHaveCount(1)
  })

  test('a default and Auto-generate exclude each other', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('items', [{ name: 'qty', type: 'integer' }])
    await page.getByLabel('Column default').fill('0')
    expect(await editor.ddl()).toContain('"qty" integer DEFAULT 0')

    await page.getByLabel('Auto-generate').check()
    await expect(page.getByLabel('Column default')).toBeDisabled()
    await expect(page.getByLabel('Column default')).toHaveValue('')
  })

  test('an enum is created, used by a column, listed as in use, and written to the DDL', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('tickets', [{ name: 'mood', type: 'text' }])
    await page.mouse.click(700, 400)
    await page.getByRole('button', { name: 'Add enum' }).click()
    await page.getByLabel('Type name').fill('mood_kind')
    await page.getByLabel('Enum values').fill('happy\nsad')

    await editor.selectTable('tickets')
    await page.getByLabel('Column type').selectOption({ label: 'mood_kind' })
    const sql = await editor.ddl()
    expect(sql).toContain(`CREATE TYPE "mood_kind" AS ENUM ('happy', 'sad');`)
    expect(sql).toContain('"mood" "mood_kind"')
    expect(sql.indexOf('CREATE TYPE')).toBeLessThan(sql.indexOf('CREATE TABLE'))

    await page.getByLabel('Array').check()
    expect(await editor.ddl()).toContain('"mood" "mood_kind"[]')

    await page.mouse.click(700, 400)
    await expect(page.getByText('Used by: tickets.mood')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove type' })).toHaveCount(
      0
    )
  })
})
