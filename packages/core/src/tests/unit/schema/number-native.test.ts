import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseProject } from '../../../project/parse-project.ts'
import { sameTypeShape } from '../../../schema/type-shape.ts'
import type { ColumnType, Schema } from '../../../schema/types.ts'
import {
  GENERATED_COLUMN_KINDS,
  SIMPLE_COLUMN_KINDS,
} from '../../../schema/types.ts'
import { validate } from '../../../schema/validate.ts'

const schemaWith = (type: ColumnType, generated = false): Schema => ({
  version: 1,
  tables: [
    {
      id: 't',
      name: 'x',
      columns: [
        {
          id: 'c',
          name: 'c',
          type,
          nullable: true,
          ...(generated ? { generated } : {}),
        },
      ],
      primaryKey: [],
    },
  ],
  relationships: [],
})

describe('the kinds', () => {
  it('number is a simple kind and can be generated', () => {
    assert.ok((SIMPLE_COLUMN_KINDS as readonly string[]).includes('number'))
    assert.ok((GENERATED_COLUMN_KINDS as readonly string[]).includes('number'))
  })
})

describe('validate: native types', () => {
  it('accepts a native with text and flags one with none', () => {
    assert.deepEqual(
      validate(
        schemaWith({ kind: 'native', dialect: 'oracle', text: 'NVARCHAR2(10)' })
      ),
      []
    )
    const issues = validate(
      schemaWith({ kind: 'native', dialect: 'oracle', text: '  ' })
    )
    assert.deepEqual(
      issues.map((i) => i.code),
      ['empty-native-type']
    )
    assert.equal(issues[0]?.columnId, 'c')
  })

  it('accepts a generated number, and still refuses generated text', () => {
    assert.deepEqual(validate(schemaWith({ kind: 'number' }, true)), [])
    assert.deepEqual(
      validate(schemaWith({ kind: 'text' }, true)).map((i) => i.code),
      ['generated-unsupported-type']
    )
  })
})

describe('sameTypeShape: native', () => {
  it('compares dialect and text, ignoring case', () => {
    const a: ColumnType = { kind: 'native', dialect: 'oracle', text: 'ROWID' }
    assert.equal(
      sameTypeShape(a, { kind: 'native', dialect: 'oracle', text: 'rowid' }),
      true
    )
    assert.equal(
      sameTypeShape(a, { kind: 'native', dialect: 'postgres', text: 'ROWID' }),
      false
    )
    assert.equal(
      sameTypeShape(a, { kind: 'native', dialect: 'oracle', text: 'XMLTYPE' }),
      false
    )
    assert.equal(sameTypeShape({ kind: 'number' }, { kind: 'number' }), true)
    assert.equal(
      sameTypeShape(
        { kind: 'number' },
        { kind: 'numeric', precision: 5, scale: 0 }
      ),
      false
    )
  })
})

describe('parseProject: number and native', () => {
  const project = (type: object) => ({
    formatVersion: 1,
    schema: {
      version: 1,
      tables: [
        {
          id: 't',
          name: 'x',
          columns: [{ id: 'c', name: 'c', type, nullable: true }],
          primaryKey: [],
        },
      ],
      relationships: [],
    },
    view: null,
  })

  it('reads both', () => {
    for (const type of [
      { kind: 'number' },
      { kind: 'native', dialect: 'oracle', text: 'XMLTYPE' },
    ]) {
      const result = parseProject(project(type))
      assert.equal(result.ok, true, JSON.stringify(type))
      if (result.ok)
        assert.deepEqual(
          result.project.schema.tables[0]?.columns[0]?.type,
          type
        )
    }
  })

  it('rejects a native with an unknown dialect, a missing or a non-string text', () => {
    for (const type of [
      { kind: 'native', dialect: 'mysql', text: 'x' },
      { kind: 'native', dialect: 'oracle' },
      { kind: 'native', dialect: 'oracle', text: 3 },
      { kind: 'native', text: 'x' },
    ]) {
      assert.equal(parseProject(project(type)).ok, false, JSON.stringify(type))
    }
  })
})
