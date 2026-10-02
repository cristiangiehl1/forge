import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'
import { ORDERS_USER_ID, USERS_ID, usersAndOrders } from '../support/small.ts'

const AUTOSAVE_MS = 800

test.describe('deleting a table', () => {
  test('the first click only arms the button; the second deletes', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.addTable('keep_me')

    await page.getByRole('button', { name: 'Delete table' }).click()
    await expect(editor.tables()).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: 'Click again to delete' })
    ).toBeVisible()

    await page.getByRole('button', { name: 'Click again to delete' }).click()
    await expect(editor.tables()).toHaveCount(0)
  })

  test('leaving the button disarms it', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.addTable('keep_me')

    await page.getByRole('button', { name: 'Delete table' }).click()
    await page.getByRole('textbox', { name: 'Table name' }).click()
    await expect(
      page.getByRole('button', { name: 'Delete table' })
    ).toBeVisible()
    await expect(editor.tables()).toHaveCount(1)
  })

  test('an armed button does not carry over to another table', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await usersAndOrders(editor)
    await editor.selectTable('users')
    await page.getByRole('button', { name: 'Delete table' }).click()
    await editor.selectTable('orders')

    await expect(
      page.getByRole('button', { name: 'Delete table' })
    ).toBeVisible()
    await expect(editor.tables()).toHaveCount(2)
  })
})

test.describe('number fields', () => {
  test('a 0 typed first does not snap to 1 while the user is still typing', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('t', [{ name: 'code', type: 'varchar' }])
    const length = page.getByRole('spinbutton', { name: 'Length' })

    await length.fill('')
    await length.pressSequentially('0')
    await expect(length).toHaveValue('0')

    await length.pressSequentially('120')
    await expect(length).toHaveValue('0120')
    await expect(editor.node('t')).toContainText('varchar(120)')
  })

  test('an out-of-range value is brought into range when the field loses focus', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('t', [{ name: 'code', type: 'varchar' }])
    const length = page.getByRole('spinbutton', { name: 'Length' })

    await length.fill('0')
    await length.blur()
    await expect(length).toHaveValue('1')
    await expect(editor.node('t')).toContainText('varchar(1)')
  })
})

test.describe('a hand-edited project', () => {
  const generatedText = JSON.stringify({
    formatVersion: 1,
    schema: {
      version: 1,
      tables: [
        {
          id: 't',
          name: 't',
          columns: [
            {
              id: 'c',
              name: 'c',
              type: { kind: 'text' },
              nullable: true,
              generated: true,
            },
          ],
          primaryKey: [],
        },
      ],
      relationships: [],
    },
    view: null,
  })

  test('a generated column of a type that cannot be generated can be cleared', async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      if (!localStorage.getItem('e2e:project-seeded')) {
        localStorage.setItem('e2e:project-seeded', '1')
        localStorage.setItem('forge:project', value)
      }
    }, generatedText)
    const editor = new Editor(page)
    await editor.open()
    await editor.selectTable('t')

    const generate = page.getByRole('checkbox', { name: 'Auto-generate' })
    await expect(generate).toBeChecked()
    await editor.showDdl()
    await expect(editor.ddlPanel()).toContainText('cannot be generated')

    // Clearing it removes the toggle (the type cannot be generated), so a plain
    // click: `uncheck()` would wait for a checkbox that is gone.
    await generate.click()
    await expect(
      page.getByRole('checkbox', { name: 'Auto-generate' })
    ).toHaveCount(0)
    expect(await editor.ddl()).toBe('CREATE TABLE "t" (\n  "c" text\n);\n')
  })
})

test.describe('the startup notice', () => {
  test('says how many problems it left out', async ({ page }) => {
    const columns = Array.from({ length: 8 }, (_, index) => ({
      id: `c${index}`,
      name: `c${index}`,
      type: 'not-a-type',
      nullable: true,
    }))
    const broken = JSON.stringify({
      formatVersion: 1,
      schema: {
        version: 1,
        tables: [{ id: 't', name: 't', columns, primaryKey: [] }],
        relationships: [],
      },
      view: null,
    })
    await page.addInitScript((value) => {
      if (!localStorage.getItem('e2e:project-seeded')) {
        localStorage.setItem('e2e:project-seeded', '1')
        localStorage.setItem('forge:project', value)
      }
    }, broken)

    const editor = new Editor(page)
    await editor.open()
    await expect(page.getByRole('alert')).toContainText('and 3 more problems')
    await expect(page.getByRole('alert').getByRole('listitem')).toHaveCount(5)
  })

  test('blocked storage shows one banner, not two', async ({ page }) => {
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
    await editor.addTable('still_works')
    await page.waitForTimeout(AUTOSAVE_MS * 2)

    await expect(page.getByRole('alert')).toHaveCount(1)
    await expect(page.getByRole('alert')).toContainText(
      'Browser storage is unavailable'
    )
  })

  test('starting a new project also resets the zoom', async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('e2e:seeded')) {
        localStorage.setItem('e2e:seeded', '1')
        localStorage.setItem('forge:project', '{"hello":"world"}')
      }
    })
    const editor = new Editor(page)
    await editor.open()
    const viewport = page.locator('.react-flow__viewport')
    const before = await viewport.evaluate(
      (element) => (element as HTMLElement).style.transform
    )

    await page.getByRole('button', { name: 'zoom in' }).click()
    await page.getByRole('button', { name: 'zoom in' }).click()
    await expect
      .poll(() =>
        viewport.evaluate((element) => (element as HTMLElement).style.transform)
      )
      .not.toBe(before)

    await page.getByRole('button', { name: 'Start a new project' }).click()
    await expect
      .poll(() =>
        viewport.evaluate((element) => (element as HTMLElement).style.transform)
      )
      .toBe(before)
  })
})

test.describe('the page itself', () => {
  test('loads without console errors or failed requests (the favicon included)', async ({
    page,
  }) => {
    const problems: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error')
        problems.push(`console: ${message.text()}`)
    })
    page.on('pageerror', (error) =>
      problems.push(`page error: ${error.message}`)
    )
    page.on('response', (response) => {
      if (response.status() >= 400)
        problems.push(`${response.status()} ${response.url()}`)
    })

    const editor = new Editor(page)
    await editor.open()
    await editor.addTable('t')
    await page.waitForTimeout(AUTOSAVE_MS)
    expect(problems).toEqual([])
  })

  test('one click on New table creates exactly one table, on a fresh page, every time', async ({
    browser,
  }) => {
    for (let run = 0; run < 10; run++) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const editor = new Editor(page)
      await editor.open({ newTableId: 'app-default' })
      await page.getByRole('button', { name: 'New table' }).click()
      await page.waitForTimeout(250)
      await expect(editor.tables(), `run ${run}`).toHaveCount(1)
      await context.close()
    }
  })

  test('relationship lines are thick enough to follow', async ({ page }) => {
    const editor = new Editor(page)
    await editor.open()
    await usersAndOrders(editor)
    await editor.connect(ORDERS_USER_ID, USERS_ID)

    const width = await editor
      .edges()
      .first()
      .locator('path.react-flow__edge-path')
      .evaluate((path) => Number.parseFloat(getComputedStyle(path).strokeWidth))
    expect(width).toBeGreaterThanOrEqual(2)
  })
})
