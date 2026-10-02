import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { shortcutOf } from '../../../../lib/history/shortcuts.ts'

const key = (
  k: string,
  mods: Partial<
    Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>
  > = {}
) =>
  shortcutOf({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  })

describe('shortcutOf', () => {
  it('Ctrl or Cmd + Z undoes', () => {
    assert.equal(key('z', { ctrlKey: true }), 'undo')
    assert.equal(key('Z', { metaKey: true }), 'undo')
  })

  it('Ctrl or Cmd + Shift + Z redoes, and so does Ctrl + Y', () => {
    assert.equal(key('z', { ctrlKey: true, shiftKey: true }), 'redo')
    assert.equal(key('Z', { metaKey: true, shiftKey: true }), 'redo')
    assert.equal(key('y', { ctrlKey: true }), 'redo')
  })

  it('ignores every other key, plain Z, Cmd + Y, and anything with Alt', () => {
    assert.equal(key('z'), null)
    assert.equal(key('y', { metaKey: true }), null)
    assert.equal(key('x', { ctrlKey: true }), null)
    assert.equal(key('z', { ctrlKey: true, altKey: true }), null)
  })
})
