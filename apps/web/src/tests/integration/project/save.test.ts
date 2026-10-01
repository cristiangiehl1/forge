import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  addTable,
  createProject,
  createSchema,
  parseProject,
} from '@forge/core'

import { saveProject } from '../../../queries/project/save-project.ts'
import {
  brokenStorage,
  memoryStorage,
  quotaStorage,
} from '../../helpers/memory-storage.ts'

const project = createProject(
  addTable(createSchema(), { id: 't1', name: 'users' }),
  { nodes: { t1: { x: 1, y: 2 } } }
)

describe('saveProject', () => {
  it('stores JSON that the core can parse back unchanged', () => {
    const storage = memoryStorage()
    assert.deepEqual(saveProject(storage, project), { ok: true })
    const stored = storage.peek()
    assert.ok(stored !== null)
    const parsed = parseProject(JSON.parse(stored))
    assert.ok(parsed.ok)
    assert.deepEqual(parsed.project, project)
  })

  it('reports a write that fails, such as a full storage', () => {
    const storage = quotaStorage('previous', 'QuotaExceededError')
    assert.deepEqual(saveProject(storage, project), {
      ok: false,
      message: 'QuotaExceededError',
    })
    assert.equal(storage.peek(), 'previous')
  })

  it('reports storage that is blocked outright', () => {
    assert.deepEqual(saveProject(brokenStorage('SecurityError'), project), {
      ok: false,
      message: 'SecurityError',
    })
  })
})
