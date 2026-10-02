import { expect, type Page, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

const ALL = [
  'users',
  'addresses',
  'categories',
  'orders',
  'order_items',
  'products',
  'reviews',
]
const RELATED = ['users', 'addresses', 'order_items']

async function exampleLoaded(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 })
  const editor = new Editor(page)
  await editor.open()
  await page.getByRole('button', { name: 'Load example' }).click()
  await expect(editor.tables()).toHaveCount(7)
  await editor.showDdl()
  return editor
}

async function expectOrdersHovered(editor: Editor) {
  for (const name of ALL) {
    const table = editor.node(name).locator('.table-node')
    if (name === 'orders') {
      await expect(table).toHaveClass(/table-node--hovered/)
      await expect(table).not.toHaveClass(/table-node--related-hover/)
    } else if (RELATED.includes(name)) {
      await expect(table).toHaveClass(/table-node--related-hover/)
      await expect(table).not.toHaveClass(/table-node--hovered/)
    } else {
      await expect(table).not.toHaveClass(/table-node--related-hover/)
      await expect(table).not.toHaveClass(/table-node--hovered/)
    }
  }
}

async function expectNoneHighlighted(page: Page) {
  await expect(page.locator('.table-node--hovered')).toHaveCount(0)
  await expect(page.locator('.table-node--related-hover')).toHaveCount(0)
}

test.describe('related tables on hover', () => {
  test('hovering a table highlights the tables it is related to in another color', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    await editor.node('orders').locator('.table-node__title').hover()
    await expectOrdersHovered(editor)
    await expect(page.locator('.table-node--related-hover')).toHaveCount(3)
    await page.screenshot({ path: 'test-results/related-hover.png' })

    await page.mouse.move(5, 300)
    await expectNoneHighlighted(page)
  })

  test('hovering its statement in the DDL does the same', async ({ page }) => {
    const editor = await exampleLoaded(page)
    await page
      .locator('.ddl-panel span[data-table]', {
        hasText: 'CREATE TABLE "orders"',
      })
      .hover()
    await expectOrdersHovered(editor)

    await page.mouse.move(5, 300)
    await expectNoneHighlighted(page)
  })
})
