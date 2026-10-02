import type { ImportResult } from '@forge/core'
import { importSql } from '@forge/core'
import { useState } from 'react'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import { describeLimit, tooBig } from '../../lib/import/limits.ts'
import {
  describeSummary,
  isEmptyImport,
  limitMessages,
  summarize,
} from '../../lib/import/summarize.ts'
import { ConfirmButton } from '../confirm-button.tsx'

const MAX_LISTED = 100

type Mode = 'add' | 'replace'

interface Parsed {
  text: string
  result: ImportResult
}

function parse(text: string): Parsed {
  return { text, result: importSql(text, () => crypto.randomUUID()) }
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const hasTables = useForgeStore((state) => state.schema.tables.length > 0)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mode, setMode] = useState<Mode>('add')
  const [fileError, setFileError] = useState<string | null>(null)

  function change(text: string) {
    setFileError(null)
    if (tooBig(new Blob([text]).size)) {
      setParsed(null)
      setFileError(`The script is over ${describeLimit()}.`)
      return
    }
    setParsed(text.trim() === '' ? null : parse(text))
  }

  async function loadFile(file: File | undefined) {
    if (!file) return
    if (tooBig(file.size)) {
      setParsed(null)
      setFileError(`"${file.name}" is over ${describeLimit()}.`)
      return
    }
    change(await file.text())
  }

  const summary = parsed ? summarize(parsed.result.schema) : null
  const errors = parsed?.result.errors ?? []
  const warnings = parsed?.result.warnings ?? []
  const canImport =
    parsed !== null &&
    summary !== null &&
    errors.length === 0 &&
    !isEmptyImport(summary)
  const replacing = hasTables && mode === 'replace'

  function run() {
    if (!parsed || !canImport) return
    forgeStore
      .getState()
      .importSchema(parsed.result.schema, replacing ? 'replace' : 'add')
    onClose()
  }

  const shownWarnings = limitMessages(warnings, MAX_LISTED)
  const shownErrors = limitMessages(errors, MAX_LISTED)

  return (
    <dialog
      className='import-dialog'
      aria-label='Import SQL'
      ref={(element) => {
        if (element && !element.open) element.showModal()
      }}
      onClose={onClose}>
      <h2 className='import-dialog__title'>Import SQL</h2>
      <p className='inspector__hint'>
        Paste a PostgreSQL script or load a .sql file. Tables, columns, primary
        and foreign keys, indexes, comments, enums and domains are imported;
        anything else is listed below and skipped.
      </p>

      <label className='field'>
        SQL
        <textarea
          aria-label='SQL'
          className='import-dialog__text'
          rows={10}
          spellCheck={false}
          placeholder='CREATE TABLE users (id integer PRIMARY KEY, …);'
          defaultValue={parsed?.text ?? ''}
          onChange={(event) => change(event.target.value)}
        />
      </label>
      <label className='field'>
        Or a file
        <input
          type='file'
          accept='.sql,text/plain'
          aria-label='SQL file'
          onChange={(event) => loadFile(event.target.files?.[0])}
        />
      </label>
      {fileError && (
        <p role='alert' className='import-dialog__error'>
          {fileError}
        </p>
      )}

      <section aria-label='Import preview' className='import-dialog__preview'>
        {summary === null ? (
          <p className='inspector__hint'>Nothing to preview yet.</p>
        ) : (
          <>
            <p>
              <strong>This script has {describeSummary(summary)}.</strong>
            </p>
            {errors.length > 0 && (
              <>
                <h3 className='inspector__heading'>Errors</h3>
                <ul aria-label='Errors' className='import-dialog__list'>
                  {shownErrors.shown.map((error) => (
                    <li
                      key={`${error.line}:${error.statement}:${error.message}`}>
                      {error.line > 0 ? `line ${error.line}: ` : ''}
                      {error.message}
                    </li>
                  ))}
                </ul>
                {shownErrors.hidden > 0 && (
                  <p className='inspector__hint'>
                    …and {shownErrors.hidden} more.
                  </p>
                )}
              </>
            )}
            {warnings.length > 0 && (
              <>
                <h3 className='inspector__heading'>
                  Skipped or changed ({warnings.length})
                </h3>
                <ul aria-label='Warnings' className='import-dialog__list'>
                  {shownWarnings.shown.map((warning) => (
                    <li
                      key={`${warning.line}:${warning.statement}:${warning.message}`}>
                      line {warning.line}: {warning.message}
                    </li>
                  ))}
                </ul>
                {shownWarnings.hidden > 0 && (
                  <p className='inspector__hint'>
                    …and {shownWarnings.hidden} more.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </section>

      {hasTables && (
        <fieldset className='import-dialog__mode'>
          <legend>The project already has tables</legend>
          <label>
            <input
              type='radio'
              name='import-mode'
              checked={mode === 'add'}
              onChange={() => setMode('add')}
            />
            Add to the project
          </label>
          <label>
            <input
              type='radio'
              name='import-mode'
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            Replace the project
          </label>
        </fieldset>
      )}

      <div className='import-dialog__actions'>
        {replacing && !canImport ? (
          <button type='button' disabled>
            Replace the project with this script
          </button>
        ) : replacing ? (
          <ConfirmButton
            label='Replace the project with this script'
            armedLabel='Click again to replace the project'
            onConfirm={run}
          />
        ) : (
          <button type='button' disabled={!canImport} onClick={run}>
            Import
          </button>
        )}
        <button type='button' onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}
