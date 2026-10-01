import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'
import { ORDERS_USER_ID, USERS_ID, usersAndOrders } from '../support/small.ts'

async function related(page: import('@playwright/test').Page) {
  const editor = new Editor(page)
  await editor.open()
  await usersAndOrders(editor)
  await editor.connect(ORDERS_USER_ID, USERS_ID)
  return editor
}

test.describe('creating relationships', () => {
  test('dragging from a column to the one it references relates them', async ({
    page,
  }) => {
    const editor = await related(page)
    await expect(editor.edges()).toHaveCount(1)

    await editor.selectTable('orders')
    await expect(page.locator('.inspector .relationship-label')).toHaveText(
      'orders.user_id → users.id'
    )
  })

  test('a column cannot be the source of two relationships', async ({
    page,
  }) => {
    const editor = await related(page)
    await editor.drag(ORDERS_USER_ID, USERS_ID)
    await expect(editor.edges()).toHaveCount(1)
  })

  test('columns of different types cannot be related', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('users', [
      { name: 'id', type: 'uuid', primaryKey: true },
    ])
    await editor.defineTable('orders', [{ name: 'user_id', type: 'text' }])

    await editor.drag(ORDERS_USER_ID, USERS_ID)
    await expect(editor.edges()).toHaveCount(0)
  })

  test('a column that is not a primary key cannot be referenced', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await usersAndOrders(editor)

    await editor.drag(ORDERS_USER_ID, { table: 'users', column: 'name' })
    await expect(editor.edges()).toHaveCount(0)
  })
})

test.describe('removing relationships', () => {
  test('clicking the line selects it and shows a remove button', async ({
    page,
  }) => {
    const editor = await related(page)
    await expect(editor.removeButton()).toHaveCount(0)

    await editor.clickRelationship()
    await expect(page.locator('.react-flow__edge.selected')).toHaveCount(1)
    await expect(editor.removeButton()).toBeVisible()
  })

  test('the button on the line removes only that relationship', async ({
    page,
  }) => {
    const editor = await related(page)
    await editor.clickRelationship()
    await editor.removeButton().click()

    await expect(editor.edges()).toHaveCount(0)
    await expect(editor.tables()).toHaveCount(2)
    await expect(editor.removeButton()).toHaveCount(0)
  })

  test('the Delete key removes a selected relationship', async ({ page }) => {
    const editor = await related(page)
    await editor.clickRelationship()
    await page.keyboard.press('Delete')

    await expect(editor.edges()).toHaveCount(0)
    await expect(editor.tables()).toHaveCount(2)
  })

  test('the inspector lists a relationship and removes it', async ({
    page,
  }) => {
    const editor = await related(page)
    await editor.selectTable('users')
    await page
      .getByRole('button', { name: /Remove relationship orders.user_id/ })
      .click()

    await expect(editor.edges()).toHaveCount(0)
    await expect(editor.tables()).toHaveCount(2)
  })

  test('Backspace and Delete with a table selected remove nothing', async ({
    page,
  }) => {
    const editor = await related(page)
    await editor.selectTable('orders')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Delete')

    await expect(editor.edges()).toHaveCount(1)
    await expect(editor.tables()).toHaveCount(2)
  })
})

test.describe('selection', () => {
  test('selecting a table deselects the relationship, and the other way round', async ({
    page,
  }) => {
    const editor = await related(page)

    await editor.clickRelationship()
    await expect(page.locator('.react-flow__edge.selected')).toHaveCount(1)

    await editor.selectTable('users')
    await expect(page.locator('.react-flow__edge.selected')).toHaveCount(0)
    await expect(editor.removeButton()).toHaveCount(0)

    await editor.clickRelationship()
    await expect(
      page.locator('.inspector__hint', { hasText: 'Select a table' })
    ).toBeVisible()
  })

  test('clicking the empty canvas clears the selection', async ({ page }) => {
    const editor = await related(page)
    await editor.clickRelationship()
    await page.mouse.click(700, 700)
    await expect(editor.removeButton()).toHaveCount(0)
    await expect(page.locator('.react-flow__edge.selected')).toHaveCount(0)
  })

  test('a table can be selected with the keyboard', async ({ page }) => {
    const editor = await related(page)
    await editor.node('users').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('textbox', { name: 'Table name' })).toHaveValue(
      'users'
    )
  })
})
