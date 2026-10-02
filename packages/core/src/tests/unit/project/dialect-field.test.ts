import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseProject } from '../../../project/parse-project.ts'
import { createProject } from '../../../project/project.ts'
import { createSchema } from '../../../schema/operations.ts'

const roundTrip = (project: unknown) =>
  parseProject(JSON.parse(JSON.stringify(project)))

describe('createProject and the dialect', () => {
  it('writes no dialect and no options unless given, so an old project is the same file', () => {
    const project = createProject(createSchema(), null)
    assert.deepEqual(Object.keys(project).sort(), [
      'formatVersion',
      'schema',
      'view',
    ])
    assert.equal('dialect' in createProject(createSchema(), null, {}), false)
    assert.equal(
      'options' in
        createProject(createSchema(), null, { dialect: 'oracle', options: {} }),
      false
    )
  })

  it('writes the dialect and the options when given', () => {
    const project = createProject(createSchema(), null, {
      dialect: 'oracle',
      options: { uuid: 'varchar36' },
    })
    assert.equal(project.dialect, 'oracle')
    assert.deepEqual(project.options, { uuid: 'varchar36' })
  })
})

describe('parseProject and the dialect', () => {
  it('reads a project without them as it always did', () => {
    const result = roundTrip(createProject(createSchema(), null))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.project.dialect, undefined)
  })

  it('reads the dialect and the options back', () => {
    const result = roundTrip(
      createProject(createSchema(), null, {
        dialect: 'oracle',
        options: { uuid: 'raw16' },
      })
    )
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.project.dialect, 'oracle')
      assert.deepEqual(result.project.options, { uuid: 'raw16' })
    }
  })

  it('rejects an unknown dialect, options that are not an object, and a bad uuid option, each with its path', () => {
    const base = { formatVersion: 1, schema: createSchema(), view: null }
    const paths = (extra: object) => {
      const result = parseProject({ ...base, ...extra })
      return result.ok ? [] : result.errors.map((e) => e.path)
    }
    assert.deepEqual(paths({ dialect: 'mysql' }), ['dialect'])
    assert.deepEqual(paths({ dialect: 3 }), ['dialect'])
    assert.deepEqual(paths({ options: 'x' }), ['options'])
    assert.deepEqual(paths({ options: { uuid: 'guid' } }), ['options.uuid'])
  })

  it('ignores an option it does not know', () => {
    const base = { formatVersion: 1, schema: createSchema(), view: null }
    const result = parseProject({
      ...base,
      dialect: 'oracle',
      options: { uuid: 'raw16', future: true },
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.project.options, { uuid: 'raw16' })
  })
})
