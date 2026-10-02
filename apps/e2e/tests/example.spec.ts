import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

const SHOTS = path.resolve(import.meta.dirname, '../screenshots')

test.describe('the example project', () => {
  test('fills an empty project with seven tables and eight foreign keys', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Load example' }).click()

    await expect(editor.tables()).toHaveCount(7)
    await expect(editor.edges()).toHaveCount(8)

    const sql = await editor.ddl()
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(7)
    expect(sql.match(/FOREIGN KEY/g)).toHaveLength(8)
    expect(sql).not.toContain('ALTER TABLE')
    expect(sql).toContain(
      'CONSTRAINT "fk_orders_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id")'
    )

    // A picture to look at: apps/e2e/screenshots/example-project.png
    await editor.page.getByRole('button', { name: 'Hide DDL' }).click()
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, 'example-project.png') })
  })

  test('shows generated ids, a composite key and several column types', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Load example' }).click()

    await expect(
      editor.node('users').locator('.table-node__badge', { hasText: 'auto' })
    ).toBeVisible()
    await expect(
      editor
        .node('order_items')
        .locator('.table-node__badge', { hasText: 'PK' })
    ).toHaveCount(2)
    await expect(editor.node('products')).toContainText('numeric(10,2)')
    await expect(editor.node('products')).toContainText('boolean')
  })

  test('asks for a second click before replacing a project that has tables', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.addTable('mine')

    await page.getByRole('button', { name: 'Load example' }).click()
    await expect(editor.tables()).toHaveCount(1)
    await expect(
      page.getByRole('button', {
        name: 'Replace the project with the example?',
      })
    ).toBeVisible()

    await page
      .getByRole('button', { name: 'Replace the project with the example?' })
      .click()
    await expect(editor.tables()).toHaveCount(7)
    await expect(editor.node('mine')).toHaveCount(0)
  })

  test('is saved like any project, and survives a reload', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Load example' }).click()
    await expect(editor.edges()).toHaveCount(8)
    await page.waitForTimeout(800)
    await page.reload()

    await expect(editor.tables()).toHaveCount(7)
    await expect(editor.edges()).toHaveCount(8)
  })

  test('can be edited: a relationship is selected by its line and removed', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Load example' }).click()
    await expect(editor.edges()).toHaveCount(8)

    await editor.clickRelationship(0)
    await expect(editor.removeButton()).toBeVisible()
    await editor.removeButton().click()
    await expect(editor.edges()).toHaveCount(7)
    await expect(editor.tables()).toHaveCount(7)
  })

  test('works from a project that could not be read', async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('e2e:seeded')) {
        localStorage.setItem('e2e:seeded', '1')
        localStorage.setItem('forge:project', '{"hello":"world"}')
      }
    })
    const editor = new Editor(page)
    await editor.open()
    await expect(page.getByRole('alert')).toContainText('could not be read')

    await page.getByRole('button', { name: 'Load example' }).click()
    await expect(editor.tables()).toHaveCount(7)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
