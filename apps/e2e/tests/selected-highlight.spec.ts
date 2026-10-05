import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

test.describe('a selected table', () => {
  test('keeps itself, the tables it relates to and its lines highlighted until deselected', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Load example' }).click()
    await expect(editor.tables()).toHaveCount(7)

    await editor.selectTable('orders')
    // The pointer leaves the table: the highlight stays, because it is selected.
    await page.mouse.move(5, 300)
    await expect(
      editor.node('orders').locator('.table-node--hovered')
    ).toHaveCount(1)
    await expect(page.locator('.table-node--related-hover')).toHaveCount(3)
    await expect(page.locator('.react-flow__edge.related')).toHaveCount(3)

    await page
      .locator('.react-flow__pane')
      .click({ position: { x: 5, y: 300 } })
    await expect(page.locator('.table-node--hovered')).toHaveCount(0)
    await expect(page.locator('.table-node--related-hover')).toHaveCount(0)
    await expect(page.locator('.react-flow__edge.related')).toHaveCount(0)
  })
})

test.describe('a selected table in the DDL', () => {
  test('keeps its statements highlighted after the pointer leaves', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Load example' }).click()
    await editor.showDdl()
    await editor.selectTable('orders')
    await page.mouse.move(5, 300)
    const active = page.locator('.ddl-statement.ddl-active')
    await expect(active.first()).toBeVisible()
    await expect(active.first()).toContainText('orders')
    await page
      .locator('.react-flow__pane')
      .click({ position: { x: 5, y: 300 } })
    await expect(active).toHaveCount(0)
  })
})
