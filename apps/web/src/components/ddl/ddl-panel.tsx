import { generateDdl, postgres } from '@forge/core'
import { useState } from 'react'

import { useForgeStore } from '../../hooks/use-forge-store.ts'

type CopyState = 'idle' | 'copied' | 'failed'

export function DdlPanel() {
  const schema = useForgeStore((state) => state.schema)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const result = generateDdl(schema, postgres)

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
            <code>{result.sql}</code>
          </pre>
        </>
      )}
    </section>
  )
}
