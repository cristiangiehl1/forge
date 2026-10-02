import { expect, type Page, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

async function exampleLoaded(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 })
  const editor = new Editor(page)
  await editor.open()
  await page.getByRole('button', { name: 'Load example' }).click()
  await expect(editor.tables()).toHaveCount(7)
  await expect(editor.edges()).toHaveCount(8)
  await editor.showDdl()
  return editor
}

/** Sample points of every line that fall inside a table (inset by 2px), if any. */
async function pointsInsideTables(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.table-node')].map((node) => ({
      name: node.querySelector('.table-node__title')?.textContent ?? '',
      rect: node.getBoundingClientRect(),
    }))
    const hits: string[] = []
    for (const path of document.querySelectorAll<SVGPathElement>(
      '.react-flow__edge-path'
    )) {
      const matrix = path.getScreenCTM()
      if (!matrix) continue
      const length = path.getTotalLength()
      for (let at = 4; at < length - 4; at += 3) {
        const point = new DOMPoint(
          path.getPointAtLength(at).x,
          path.getPointAtLength(at).y
        ).matrixTransform(matrix)
        for (const { name, rect } of boxes) {
          if (
            point.x > rect.left + 2 &&
            point.x < rect.right - 2 &&
            point.y > rect.top + 2 &&
            point.y < rect.bottom - 2
          )
            hits.push(`${name} @ ${Math.round(point.x)},${Math.round(point.y)}`)
        }
      }
    }
    return hits
  })
}

test.describe('layout, routing and hover', () => {
  test('a table is exactly as big as the geometry says', async ({ page }) => {
    const editor = await exampleLoaded(page)
    for (const name of ['users', 'orders', 'order_items', 'categories']) {
      const size = await editor
        .node(name)
        .locator('.table-node')
        .evaluate((element) => ({
          w: (element as HTMLElement).offsetWidth,
          h: (element as HTMLElement).offsetHeight,
          rows: element.querySelectorAll('.table-node__column').length,
        }))
      expect(size.w).toBe(220)
      expect(size.h).toBe(33 + 26 * size.rows)
    }
  })

  test('no line passes through a table, before and after arranging and moving', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    expect(await pointsInsideTables(page)).toEqual([])

    await editor.moveTable('orders', 60, 90)
    await expect.poll(() => pointsInsideTables(page)).toEqual([])

    await page.getByRole('button', { name: 'Auto-arrange' }).click()
    await expect.poll(() => pointsInsideTables(page)).toEqual([])
  })

  test('parents sit to the left of the tables that reference them', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    const left = async (name: string) =>
      (await editor.node(name).locator('.table-node').boundingBox())?.x ?? NaN
    expect(await left('users')).toBeLessThan(await left('orders'))
    expect(await left('orders')).toBeLessThan(await left('order_items'))
    expect(await left('products')).toBeLessThan(await left('order_items'))
    expect(await left('categories')).toBeLessThan(await left('products'))
  })

  test('hovering a table highlights it, its lines and its statement', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    await editor.node('orders').locator('.table-node__title').hover()

    await expect(page.locator('.table-node--hovered')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge.related')).toHaveCount(3)
    const active = page.locator('.ddl-active')
    await expect(active).toHaveCount(1)
    await expect(active).toContainText('CREATE TABLE "orders"')

    await page.mouse.move(5, 300)
    await expect(page.locator('.table-node--hovered')).toHaveCount(0)
    await expect(page.locator('.ddl-active')).toHaveCount(0)
  })

  test('hovering a statement in the DDL highlights its table', async ({
    page,
  }) => {
    const editor = await exampleLoaded(page)
    await page
      .locator('.ddl-panel span[data-table]', {
        hasText: 'CREATE TABLE "reviews"',
      })
      .hover()
    await expect(page.locator('.table-node--hovered')).toHaveCount(1)
    await expect(
      editor.node('reviews').locator('.table-node--hovered')
    ).toHaveCount(1)
  })

  test('Auto-arrange is disabled with no tables and arranges a messy canvas', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await page.setViewportSize({ width: 1400, height: 900 })
    await editor.open()
    await expect(
      page.getByRole('button', { name: 'Auto-arrange' })
    ).toBeDisabled()

    await page.getByRole('button', { name: 'Load example' }).click()
    await editor.moveTable('users', 300, 200)
    const before = await editor.position('users')
    await page.getByRole('button', { name: 'Auto-arrange' }).click()
    await expect.poll(() => editor.position('users')).not.toBe(before)
  })

  test('a line can be drawn from the left side of a table to the right side of another', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await page.setViewportSize({ width: 1400, height: 900 })
    await editor.open()
    await editor.defineTable('users', [
      { name: 'id', type: 'uuid', primaryKey: true },
    ])
    await editor.defineTable('orders', [{ name: 'user_id', type: 'uuid' }])
    await editor.drag(
      { table: 'orders', column: 'user_id' },
      { table: 'users', column: 'id' },
      { from: 'l', to: 'r' }
    )
    await expect(editor.edges()).toHaveCount(1)
  })
})
