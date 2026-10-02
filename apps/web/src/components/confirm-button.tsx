import { useState } from 'react'

interface ConfirmButtonProps {
  label: string
  /** What the button says once armed: the question the second click answers. */
  armedLabel: string
  className?: string
  onConfirm: () => void
}

/**
 * For an action that throws work away: the first click only arms the button, a
 * second click does it, and leaving the button disarms it again.
 */
export function ConfirmButton({
  label,
  armedLabel,
  className,
  onConfirm,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false)

  return (
    <button
      type='button'
      className={className}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        onConfirm()
      }}
      onBlur={() => setArmed(false)}>
      {armed ? armedLabel : label}
    </button>
  )
}
