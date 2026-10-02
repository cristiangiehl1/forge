import { useState } from 'react'

import { parseDraft } from '../../lib/number-draft.ts'

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}

/**
 * A number input that keeps what is being typed. A usable value is committed as
 * it is typed; anything else (empty, out of range) waits until the field loses
 * focus, when the app's own limits decide what it becomes. That way a 0 typed
 * first, on the way to 120, does not snap to 1 under the user's fingers.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <input
      aria-label={label}
      type='number'
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={(event) => {
        setDraft(event.target.value)
        const parsed = parseDraft(event.target.value, min, max)
        if (parsed !== null) onCommit(parsed)
      }}
      onBlur={(event) => {
        const text = event.target.value.trim()
        // A whole number outside the range: commit it and let the setter clamp.
        if (/^-?\d+$/.test(text) && parseDraft(text, min, max) === null) {
          onCommit(Number(text))
        }
        setDraft(null)
      }}
    />
  )
}
