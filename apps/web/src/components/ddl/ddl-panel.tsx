import { generateDdl, postgres } from '@forge/core'
import { useEffect, useRef, useState } from 'react'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'

type CopyState = 'idle' | 'copied' | 'failed'

export function DdlPanel() {
  const schema = useForgeStore((state) => state.schema)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const hoveredTable = useForgeStore((state) => state.hoveredTable)
  const activeRef = useRef<HTMLSpanElement | null>(null)
  // True while the pointer is over a statement: the hover then comes from the
  // panel itself, and scrolling it to a statement would move what is under the
  // pointer.
  const pointerInPanel = useRef(false)
  const result = generateDdl(schema, postgres)

  // Bring the hovered table's statement into view; the panel scrolls, not the page.
  useEffect(() => {
    if (hoveredTable && !pointerInPanel.current) {
      activeRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [hoveredTable])

  async function copy(sql: string) {
    try {
      await navigator.clipboard.writeText(sql)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    setTimeout(() => setCopyState('idle'), 1500)
  }

  if (!result.ok) {
    return (
      <section className='ddl-panel' aria-label='DDL'>
        <p>Fix these problems to generate the DDL:</p>
        <ul>
          {result.issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.tableId ?? ''}:${issue.columnId ?? ''}:${issue.relationshipId ?? ''}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className='ddl-panel' aria-label='DDL'>
      {result.sql === '' ? (
        <p>Add a table to generate the DDL.</p>
      ) : (
        <>
          <button type='button' onClick={() => copy(result.sql)}>
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy'}
          </button>
          <pre>
            <code>
              {result.statements.map((statement, index) => {
                const tableId =
                  'tableId' in statement ? statement.tableId : null
                const active = tableId !== null && tableId === hoveredTable
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only link between a statement and its table; nothing here is needed to use the app
                  <span
                    key={statement.key}
                    ref={
                      active && statement.kind === 'create' ? activeRef : null
                    }
                    data-table={tableId ?? undefined}
                    data-type={
                      statement.kind === 'type' ? statement.typeId : undefined
                    }
                    className={
                      active ? 'ddl-statement ddl-active' : 'ddl-statement'
                    }
                    onMouseEnter={() => {
                      pointerInPanel.current = true
                      if (tableId !== null) {
                        forgeStore.getState().hoverTable(tableId)
                      }
                    }}
                    onMouseLeave={() => {
                      pointerInPanel.current = false
                      forgeStore.getState().hoverTable(null)
                    }}>
                    {statement.sql}
                    {index < result.statements.length - 1 ? '\n\n' : '\n'}
                  </span>
                )
              })}
            </code>
          </pre>
        </>
      )}
    </section>
  )
}
