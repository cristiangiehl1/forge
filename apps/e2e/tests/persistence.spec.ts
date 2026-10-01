import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'
import { ORDERS_USER_ID, USERS_ID, usersAndOrders } from '../support/small.ts'

// The project is autosaved 500 ms after the last change.
const AUTOSAVE_MS = 800

test.describe('persistence', () => {
  test('a reload restores tables, columns, relationships and positions', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await usersAndOrders(editor)
    await editor.connect(ORDERS_USER_ID, USERS_ID)
    await editor.moveTable('orders', 0, 120)
    const moved = await editor.position('orders')

    await page.waitForTimeout(AUTOSAVE_MS)
    await page.reload()

    await expect(editor.tables()).toHaveCount(2)
    await expect(editor.edges()).toHaveCount(1)
    expect(await editor.position('orders')).toBe(moved)
    await editor.selectTable('orders')
    await expect(
      page.locator('.inspector .column-list').first().locator('.column-row')
    ).toHaveCount(2)
  })

  test('a project written by a newer version is reported and left untouched', async ({
    page,
  }) => {
    const newer = JSON.stringify({ formatVersion: 99, schema: {}, view: null })
    await page.addInitScript((value) => {
      if (!localStorage.getItem('e2e:seeded')) {
        localStorage.setItem('e2e:seeded', '1')
        localStorage.setItem('forge:project', value)
      }
    }, newer)

    const editor = new Editor(page)
    await editor.open()
    await expect(page.getByRole('alert')).toContainText('could not be read')
    await expect(page.getByRole('alert')).toContainText('version 99')

    await editor.addTable('draft')
    await page.waitForTimeout(AUTOSAVE_MS)
    await page.reload()
    await expect(page.getByRole('alert')).toContainText('could not be read')
    expect(
      await page.evaluate(() => localStorage.getItem('forge:project'))
    ).toBe(newer)
  })

  test('starting a new project replaces an unreadable one', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('e2e:seeded')) {
        localStorage.setItem('e2e:seeded', '1')
        localStorage.setItem('forge:project', '{"hello":"world"}')
      }
    })

    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Start a new project' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)

    await editor.addTable('fresh')
    await page.waitForTimeout(AUTOSAVE_MS)
    const stored = await page.evaluate(() =>
      localStorage.getItem('forge:project')
    )
    expect(JSON.parse(stored ?? '{}').schema.tables).toHaveLength(1)
  })

  test('the app stays usable when browser storage is blocked', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('SecurityError: storage is blocked')
      }
      Storage.prototype.setItem = () => {
        throw new Error('SecurityError: storage is blocked')
      }
    })

    const editor = new Editor(page)
    await editor.open()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Browser storage is unavailable' })
    ).toBeVisible()

    await editor.addTable('still_works')
    await expect(editor.node('still_works')).toBeVisible()
  })
})
