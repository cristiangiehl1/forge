import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import { debounce } from '../../../../lib/import/debounce.ts'

afterEach(() => mock.timers.reset())

describe('debounce', () => {
  it('runs once, with the last arguments, after the quiet period', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    const seen: string[] = []
    const call = debounce(300, (text: string) => seen.push(text))
    call.run('a')
    mock.timers.tick(200)
    call.run('ab')
    mock.timers.tick(200)
    assert.deepEqual(seen, [])
    mock.timers.tick(100)
    assert.deepEqual(seen, ['ab'])
  })

  it('does not run after cancel, and can be used again', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    const seen: string[] = []
    const call = debounce(300, (text: string) => seen.push(text))
    call.run('a')
    call.cancel()
    mock.timers.tick(1000)
    assert.deepEqual(seen, [])
    call.run('b')
    mock.timers.tick(300)
    assert.deepEqual(seen, ['b'])
  })
})
