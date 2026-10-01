import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addTable, createProject, createSchema } from '@forge/core'

import { loadProject } from '../../../queries/project/load-project.ts'
import { saveProject } from '../../../queries/project/save-project.ts'
import { brokenStorage, memoryStorage } from '../../helpers/memory-storage.ts'

const schema = addTable(createSchema(), { id: 't1', name: 'users' })
const view = { nodes: { t1: { x: 1, y: 2 } } }

describe('loadProject', () => {
  it('reports an empty storage', () => {
    assert.deepEqual(loadProject(memoryStorage()), { status: 'empty' })
  })

  it('loads what saveProject stored', () => {
    const storage = memoryStorage()
    assert.deepEqual(saveProject(storage, createProject(schema, view)), {
      ok: true,
    })
    assert.deepEqual(loadProject(storage), {
      status: 'loaded',
      project: createProject(schema, view),
    })
  })

  it('reports text that is not JSON', () => {
    const result = loadProject(memoryStorage('{ not json'))
    assert.equal(result.status, 'invalid')
    assert.ok(result.status === 'invalid')
    assert.match(result.errors[0]?.message ?? '', /JSON/)
  })

  it('reports JSON that came from another app', () => {
    const result = loadProject(memoryStorage('{"hello":"world"}'))
    assert.ok(result.status === 'invalid')
    assert.match(result.errors[0]?.message ?? '', /format version/)
  })

  it('reports a project written by a newer version of the app', () => {
    const newer = JSON.stringify({
      ...createProject(schema, view),
      formatVersion: 2,
    })
    const result = loadProject(memoryStorage(newer))
    assert.ok(result.status === 'invalid')
    assert.match(result.errors[0]?.message ?? '', /version 2/)
  })

  it('reports a relationship that points at a deleted table', () => {
    const broken = JSON.stringify({
      ...createProject(schema, view),
      schema: {
        ...schema,
        relationships: [
          {
            id: 'r',
            from: { tableId: 't1', columnId: 'c' },
            to: { tableId: 'gone', columnId: 'c' },
          },
        ],
      },
    })
    const result = loadProject(memoryStorage(broken))
    assert.ok(result.status === 'invalid')
    assert.ok(result.errors[0]?.path.startsWith('schema.relationships'))
  })

  it('reports storage that cannot be read', () => {
    const result = loadProject(brokenStorage('SecurityError: blocked'))
    assert.deepEqual(result, {
      status: 'unavailable',
      message: 'SecurityError: blocked',
    })
  })

  it('never modifies the stored value, even when it is invalid', () => {
    const raw = '{"hello":"world"}'
    const storage = memoryStorage(raw)
    loadProject(storage)
    assert.equal(storage.peek(), raw)
  })
})
