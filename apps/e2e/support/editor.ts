import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export type ColumnKind =
  | 'integer'
  | 'bigint'
  | 'text'
  | 'boolean'
  | 'uuid'
  | 'timestamp'
  | 'date'
  | 'json'
  | 'varchar'
  | 'numeric'

export type NewTableId = 'integer' | 'uuid' | 'none'

export interface ColumnSpec {
  name: string
  type?: ColumnKind
  length?: number
  precision?: number
  scale?: number
  primaryKey?: boolean
  notNull?: boolean
  generated?: boolean
}

export interface ColumnRef {
  table: string
  column: string
}

const exact = (text: string) =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

/** The Forge editor as a person uses it: tables, columns, relationships. */
export class Editor {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  /**
   * Opens the editor. Tests that build their own columns want new tables to
   * start empty, so the "New tables start with" preference is seeded to
   * `none`; pass `'app-default'` to leave it as a first-time user sees it.
   */
  async open(options: { newTableId?: NewTableId | 'app-default' } = {}) {
    const choice = options.newTableId ?? 'none'
    if (choice !== 'app-default') {
      await this.page.addInitScript((value) => {
        try {
          if (!localStorage.getItem('e2e:settings-seeded')) {
            localStorage.setItem('e2e:settings-seeded', '1')
            localStorage.setItem(
              'forge:settings',
              JSON.stringify({ newTableId: value })
            )
          }
        } catch {
          // storage may be blocked on purpose by the test
        }
      }, choice)
    }
    await this.page.goto('/')
    await expect(
      this.page.getByRole('button', { name: 'New table' })
    ).toBeVisible()
  }

  newTableIdSelect(): Locator {
    return this.page.getByRole('combobox', { name: 'New tables start with' })
  }

  async chooseNewTableId(choice: NewTableId) {
    await this.newTableIdSelect().selectOption(choice)
  }

  // ---- tables

  node(table: string): Locator {
    return this.page.locator('.react-flow__node').filter({
      has: this.page.locator('.table-node__title', { hasText: exact(table) }),
    })
  }

  tables(): Locator {
    return this.page.locator('.table-node')
  }

  async addTable(name: string) {
    await this.page.getByRole('button', { name: 'New table' }).click()
    await this.page.getByRole('textbox', { name: 'Table name' }).fill(name)
    await expect(this.node(name)).toBeVisible()
  }

  async selectTable(name: string) {
    await this.node(name).locator('.table-node__title').click()
    await expect(
      this.page.getByRole('textbox', { name: 'Table name' })
    ).toHaveValue(name)
  }

  /** Creates a table and fills it with columns; leaves it selected. */
  async defineTable(name: string, columns: ColumnSpec[]) {
    await this.addTable(name)
    for (const column of columns) await this.addColumn(column)
  }

  // ---- columns (the table must be selected)

  columnRows(): Locator {
    return this.page
      .locator('.inspector .column-list')
      .first()
      .locator('.column-row')
  }

  async addColumn(spec: ColumnSpec) {
    await this.page.getByRole('button', { name: 'Add column' }).click()
    const row = this.columnRows().last()
    await row.getByRole('textbox', { name: 'Column name' }).fill(spec.name)
    if (spec.type) {
      await row
        .getByRole('combobox', { name: 'Column type' })
        .selectOption(spec.type)
    }
    if (spec.length !== undefined) {
      await row
        .getByRole('spinbutton', { name: 'Length' })
        .fill(String(spec.length))
    }
    // Precision first: lowering it also lowers the scale.
    if (spec.precision !== undefined) {
      await row
        .getByRole('spinbutton', { name: 'Precision' })
        .fill(String(spec.precision))
    }
    if (spec.scale !== undefined) {
      await row
        .getByRole('spinbutton', { name: 'Scale' })
        .fill(String(spec.scale))
    }
    if (spec.primaryKey) {
      await row.getByRole('checkbox', { name: 'PK' }).check()
    }
    if (spec.notNull && !spec.primaryKey) {
      await row.getByRole('checkbox', { name: 'NOT NULL' }).check()
    }
    if (spec.generated) {
      await row.getByRole('checkbox', { name: 'Auto-generate' }).check()
    }
  }

  /** Deleting a table takes two clicks: the first only arms the button. */
  async deleteSelectedTable() {
    await this.page.getByRole('button', { name: 'Delete table' }).click()
    await this.page
      .getByRole('button', { name: 'Click again to delete' })
      .click()
  }

  // ---- relationships

  edges(): Locator {
    return this.page.locator('.react-flow__edge')
  }

  private handle(ref: ColumnRef, kind: 'source' | 'target'): Locator {
    return this.node(ref.table)
      .locator('.table-node__column')
      .filter({
        has: this.page.locator('.table-node__name', {
          hasText: exact(ref.column),
        }),
      })
      .locator(`.react-flow__handle.${kind}`)
  }

  /** Drags from `from` to `to` once, without checking the outcome. */
  async drag(from: ColumnRef, to: ColumnRef) {
    const source = this.handle(from, 'source')
    const target = this.handle(to, 'target')
    await expect(source).toBeAttached()
    await expect(target).toBeAttached()
    const a = await source.boundingBox()
    const b = await target.boundingBox()
    if (!a || !b) throw new Error('A column handle has no position on screen.')
    const { mouse } = this.page
    await mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await mouse.down()
    await mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 })
    await mouse.up()
  }

  /** Relates two columns and waits until the new line is on the canvas. */
  async connect(from: ColumnRef, to: ColumnRef) {
    const before = await this.edges().count()
    // React Flow measures a new column's handle a moment after it appears.
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.drag(from, to)
      try {
        await expect(this.edges()).toHaveCount(before + 1, { timeout: 1500 })
        return
      } catch {
        // not connected yet: try again
      }
    }
    throw new Error(
      `Could not relate ${from.table}.${from.column} to ${to.table}.${to.column}.`
    )
  }

  /** Clicks a relationship line at the middle of its path. */
  async clickRelationship(index = 0) {
    const path = this.edges()
      .nth(index)
      .locator('path.react-flow__edge-interaction')
    const point = await path.evaluate((element) => {
      const svgPath = element as SVGPathElement
      const middle = svgPath.getPointAtLength(svgPath.getTotalLength() / 2)
      const matrix = svgPath.getScreenCTM()
      if (!matrix) return null
      const onScreen = new DOMPoint(middle.x, middle.y).matrixTransform(matrix)
      return { x: onScreen.x, y: onScreen.y }
    })
    if (!point) throw new Error('The relationship line has no screen position.')
    await this.page.mouse.click(point.x, point.y)
  }

  removeButton(): Locator {
    return this.page.locator('.edge-delete')
  }

  async moveTable(name: string, dx: number, dy: number) {
    const title = this.node(name).locator('.table-node__title')
    const box = await title.boundingBox()
    if (!box) throw new Error(`Table ${name} has no position on screen.`)
    const { mouse } = this.page
    await mouse.move(box.x + 20, box.y + 8)
    await mouse.down()
    await mouse.move(box.x + 20 + dx, box.y + 8 + dy, { steps: 10 })
    await mouse.up()
  }

  /** Where a table node sits, as React Flow positions it. */
  async position(name: string): Promise<string> {
    return this.node(name).evaluate(
      (element) => (element as HTMLElement).style.transform
    )
  }

  // ---- DDL

  async showDdl() {
    const toggle = this.page.getByRole('button', { name: /(Show|Hide) DDL/ })
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click()
    }
    await expect(this.page.locator('.ddl-panel')).toBeVisible()
  }

  ddlPanel(): Locator {
    return this.page.locator('.ddl-panel')
  }

  async ddl(): Promise<string> {
    await this.showDdl()
    return this.page.locator('.ddl-panel pre').innerText()
  }
}
