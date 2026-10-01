import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createProject,
  generateDdl,
  parseProject,
  postgres,
} from '../../../index.ts'
import { usersOrders } from '../../helpers/fixtures.ts'

describe('project round trip', () => {
  it('survives JSON serialization unchanged', () => {
    const view = {
      nodes: { users: { x: 1, y: 2 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const stored = JSON.stringify(createProject(usersOrders, view))
    const parsed = parseProject(JSON.parse(stored))
    assert.ok(parsed.ok)
    assert.deepEqual(parsed.project, createProject(usersOrders, view))
  })

  it('generates identical DDL before and after a round trip', () => {
    const before = generateDdl(usersOrders, postgres)
    const parsed = parseProject(
      JSON.parse(JSON.stringify(createProject(usersOrders, null)))
    )
    assert.ok(parsed.ok)
    const after = generateDdl(parsed.project.schema, postgres)
    assert.deepEqual(after, before)
  })
})
