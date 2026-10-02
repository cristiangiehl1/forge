export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** Which history command a key press is, if any. */
export function shortcutOf(event: KeyLike): 'undo' | 'redo' | null {
  if (event.altKey) return null
  const key = event.key.toLowerCase()
  const command = event.ctrlKey || event.metaKey
  if (command && key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (event.ctrlKey && !event.metaKey && key === 'y') return 'redo'
  return null
}
