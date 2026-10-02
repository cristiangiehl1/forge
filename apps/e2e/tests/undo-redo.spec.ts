import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

const undo = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Undo', exact: true })
const redo = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Redo', exact: true })

async function start(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1400, height: 900 })
  const editor = new Editor(page)
  await editor.open()
  return editor
}

test.describe('undo and redo', () => {
  test('the buttons start disabled, and follow what can be undone and redone', async ({
    page,
  }) => {
    const editor = await start(page)
    await expect(undo(page)).toBeDisabled()
    await expect(redo(page)).toBeDisabled()

    await page.getByRole('button', { name: 'New table' }).click()
    await expect(editor.tables()).toHaveCount(1)
    await expect(undo(page)).toBeEnabled()
    await expect(redo(page)).toBeDisabled()

    await undo(page).click()
    await expect(editor.tables()).toHaveCount(0)
    await expect(undo(page)).toBeDisabled()
    await expect(redo(page)).toBeEnabled()

    await redo(page).click()
    await expect(editor.tables()).toHaveCount(1)
  })

  test('typing a table name is undone in one step', async ({ page }) => {
    const editor = await start(page)
    await page.getByRole('button', { name: 'New table' }).click()
    const name = page.getByRole('textbox', { name: 'Table name' })
    await name.fill('')
    await name.pressSequentially('customers', { delay: 30 })
    await expect(editor.node('customers')).toBeVisible()
    await undo(page).click()
    await expect(editor.node('table_1')).toBeVisible()
    await undo(page).click()
    await expect(editor.tables()).toHaveCount(0)
  })

  test('dragging a table is undone in one step, back to where it was', async ({
    page,
  }) => {
    const editor = await start(page)
    await editor.addTable('movable')
    await page.waitForTimeout(1100)
    const before = await editor.position('movable')
    await editor.moveTable('movable', 150, 120)
    await expect.poll(() => editor.position('movable')).not.toBe(before)
    await undo(page).click()
    await expect.poll(() => editor.position('movable')).toBe(before)
  })

  test('the keys work, in the canvas and inside an Inspector field', async ({
    page,
  }) => {
    const editor = await start(page)
    await page.getByRole('button', { name: 'New table' }).click()
    await expect(editor.tables()).toHaveCount(1)

    await page.getByRole('textbox', { name: 'Table name' }).click()
    await page.keyboard.press('Control+z')
    await expect(editor.tables()).toHaveCount(0)
    await page.keyboard.press('Control+Shift+z')
    await expect(editor.tables()).toHaveCount(1)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+y')
    await expect(editor.tables()).toHaveCount(1)
  })

  test('removing a table with a relationship is undone with the relationship', async ({
    page,
  }) => {
    const editor = await start(page)
    await page.getByRole('button', { name: 'Load example' }).click()
    await expect(editor.edges()).toHaveCount(8)
    await editor.selectTable('users')
    await editor.deleteSelectedTable()
    await expect(editor.tables()).toHaveCount(6)
    await undo(page).click()
    await expect(editor.tables()).toHaveCount(7)
    await expect(editor.edges()).toHaveCount(8)
  })

  test('loading the example can be undone, and so can an import', async ({
    page,
  }) => {
    const editor = await start(page)
    await editor.addTable('mine')
    await page.getByRole('button', { name: 'Load example' }).click()
    await page
      .getByRole('button', { name: 'Replace the project with the example?' })
      .click()
    await expect(editor.tables()).toHaveCount(7)
    await undo(page).click()
    await expect(editor.tables()).toHaveCount(1)
    await expect(editor.node('mine')).toBeVisible()

    await page.getByRole('button', { name: 'Import SQL' }).click()
    await page
      .getByRole('dialog')
      .getByLabel('SQL', { exact: true })
      .fill('CREATE TABLE imported (id int);')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Import', exact: true })
      .click()
    await expect(editor.tables()).toHaveCount(2)
    await undo(page).click()
    await expect(editor.tables()).toHaveCount(1)
  })

  test('Ctrl+Z inside the import dialog does not undo the project', async ({
    page,
  }) => {
    const editor = await start(page)
    await editor.addTable('kept')
    await page.getByRole('button', { name: 'Import SQL' }).click()
    const box = page.getByRole('dialog').getByLabel('SQL', { exact: true })
    await box.fill('CREATE TABLE x (id int);')
    await box.press('Control+z')
    await page.keyboard.press('Escape')
    await expect(editor.tables()).toHaveCount(1)
    await expect(editor.node('kept')).toBeVisible()
  })

  test('selecting a table and zooming are not steps', async ({ page }) => {
    const editor = await start(page)
    await editor.addTable('one')
    await editor.addTable('two')
    await editor.selectTable('one')
    await page.mouse.move(700, 400)
    await page.mouse.wheel(0, 200)
    // The last step is the rename of the second table; the selection and the
    // zoom that came after it are not steps, so they did not take its place.
    await undo(page).click()
    await expect(editor.tables()).toHaveCount(2)
    await expect(editor.node('table_1')).toBeVisible()
    await undo(page).click()
    await expect(editor.tables()).toHaveCount(1)
  })
})
