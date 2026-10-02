import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

test.describe('the DDL panel scroll', () => {
  test('hovering a statement in the panel does not scroll the panel', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Load example' }).click()
    await editor.showDdl()

    const panel = page.locator('.ddl-panel')
    // Scrolled to the end, where the indexes and comments are: their tables'
    // CREATE TABLE statements are far above.
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const before = await panel.evaluate((element) => element.scrollTop)
    expect(before).toBeGreaterThan(0)

    const box = await panel.boundingBox()
    if (!box) throw new Error('The DDL panel has no box.')
    for (const offset of [30, 60, 90, 120, 150]) {
      await page.mouse.move(box.x + 120, box.y + box.height - offset)
      await page.waitForTimeout(150)
    }
    expect(await panel.evaluate((element) => element.scrollTop)).toBe(before)
  })

  test('hovering a table on the canvas still scrolls its statement into view', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Load example' }).click()
    await editor.showDdl()

    const panel = page.locator('.ddl-panel')
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const before = await panel.evaluate((element) => element.scrollTop)
    await editor.node('users').locator('.table-node__title').hover()
    await expect
      .poll(() => panel.evaluate((element) => element.scrollTop))
      .toBeLessThan(before)
  })
})
