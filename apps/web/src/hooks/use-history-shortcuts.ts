import { useEffect } from 'react'

import { shortcutOf } from '../lib/history/shortcuts.ts'
import { forgeStore } from './use-forge-store.ts'

/**
 * Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y act on the project everywhere, the
 * Inspector's fields included: the store controls them, so the browser's own
 * undo would put them out of step. A dialog keeps its own text, and the
 * browser's undo works there.
 */
export function useHistoryShortcuts(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const command = shortcutOf(event)
      if (command === null) return
      const target = event.target
      if (target instanceof Element && target.closest('dialog')) return
      event.preventDefault()
      if (command === 'undo') forgeStore.getState().undo()
      else forgeStore.getState().redo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
