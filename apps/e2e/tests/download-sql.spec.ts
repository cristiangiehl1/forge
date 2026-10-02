import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { Editor } from '../support/editor.ts'

test.describe('downloading the DDL', () => {
  test('the button downloads forge-schema.sql with exactly the script the panel shows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    const editor = new Editor(page)
    await editor.open()
    await page.getByRole('button', { name: 'Load example' }).click()
    const shown = await editor.ddl()

    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download .sql' }).click()
    const download = await downloading

    expect(download.suggestedFilename()).toBe('forge-schema.sql')
    const path = await download.path()
    expect(readFileSync(path, 'utf8')).toBe(shown)
    expect(shown).toContain('CREATE TABLE')
  })

  test('there is nothing to download for an empty project', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.showDdl()
    await expect(
      page.getByRole('button', { name: 'Download .sql' })
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(0)
  })

  test('there is nothing to download while the schema has problems', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.addTable('broken')
    await page.getByRole('textbox', { name: 'Table name' }).fill('')
    await editor.showDdl()
    await expect(
      page.getByText('Fix these problems to generate the DDL')
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Download .sql' })
    ).toHaveCount(0)
  })

  test('it follows the project: the file has what the panel has after an edit', async ({
    page,
  }) => {
    const editor = new Editor(page)
    await editor.open()
    await editor.defineTable('first', [{ name: 'id', type: 'integer' }])
    await editor.showDdl()
    await editor.addTable('second')
    const shown = await editor.ddl()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download .sql' }).click()
    const download = await downloading
    expect(readFileSync(await download.path(), 'utf8')).toBe(shown)
    expect(shown).toContain('"second"')
  })
})
