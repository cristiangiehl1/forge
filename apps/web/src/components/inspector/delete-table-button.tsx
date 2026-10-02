import { useState } from 'react'

/**
 * Deleting a table also deletes its relationships and there is no undo, so the
 * first click only arms the button; a second click deletes, and leaving the
 * button disarms it again.
 */
export function DeleteTableButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)

  return (
    <button
      type='button'
      className='danger'
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        onConfirm()
      }}
      onBlur={() => setArmed(false)}>
      {armed ? 'Click again to delete' : 'Delete table'}
    </button>
  )
}
