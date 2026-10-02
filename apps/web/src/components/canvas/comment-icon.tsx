import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small mark that shows a comment on hover or focus. The tooltip is drawn in
 * the page body, not inside the table node, so no other table can cover it and
 * it never changes the fixed size of the node.
 */
export function CommentIcon({ text, label }: { text: string; label: string }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const tooltipId = useId()

  // The tooltip is placed once; zooming or scrolling the canvas would leave it
  // behind the icon, so it goes away instead.
  useEffect(() => {
    if (!anchor) return
    const hide = () => setAnchor(null)
    // Capturing: React Flow handles the wheel itself and may stop it bubbling.
    window.addEventListener('wheel', hide, { passive: true, capture: true })
    return () => window.removeEventListener('wheel', hide, { capture: true })
  }, [anchor])
  const show = (element: HTMLElement) => {
    const box = element.getBoundingClientRect()
    setAnchor({ x: box.left + box.width / 2, y: box.bottom + 6 })
  }

  return (
    <>
      <button
        type='button'
        className='comment-icon nodrag nopan'
        aria-label={label}
        aria-describedby={anchor ? tooltipId : undefined}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={() => setAnchor(null)}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setAnchor(null)}
      />
      {anchor &&
        createPortal(
          <div
            role='tooltip'
            id={tooltipId}
            className='comment-tooltip'
            style={{ left: anchor.x, top: anchor.y }}>
            {text}
          </div>,
          document.body
        )}
    </>
  )
}
