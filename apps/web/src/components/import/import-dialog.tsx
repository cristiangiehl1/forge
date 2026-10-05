import type { DialectId, ImportResult } from '@forge/core'
import { DIALECT_IDS, importSql } from '@forge/core'
import { useEffect, useRef, useState } from 'react'

import { forgeStore, useForgeStore } from '../../hooks/use-forge-store.ts'
import { debounce } from '../../lib/import/debounce.ts'
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

interface ToParse {
  text: string
  readAs: DialectId
}

interface Parsed {
  text: string
  result: ImportResult
}

function parse(text: string, readAs: DialectId): Parsed | null {
  if (text.trim() === '') return null
  return { text, result: importSql(text, () => crypto.randomUUID(), readAs) }
}

const DIALECT_LABELS: Record<DialectId, string> = {
  postgres: 'PostgreSQL',
  oracle: 'Oracle',
}

/** How long the text must rest before it is parsed again. */
const PARSE_DELAY_MS = 300

export function ImportDialog({ onClose }: { onClose: () => void }) {
  // A project that has only types is not empty either: the store merges into it.
  const hasContent = useForgeStore(
    (state) =>
      state.schema.tables.length > 0 || (state.schema.types ?? []).length > 0
  )
  const dialect = useForgeStore((state) => state.dialect)
  const [readAs, setReadAs] = useState<DialectId>(dialect)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<Parsed | null>(null)
  // The preview lags the text by the debounce; Import waits for it to catch up.
  const [pending, setPending] = useState(false)
  const [mode, setMode] = useState<Mode>('add')
  const [fileError, setFileError] = useState<string | null>(null)
  const [later] = useState(() =>
    debounce(PARSE_DELAY_MS, (value: ToParse) => {
      setParsed(parse(value.text, value.readAs))
      setPending(false)
    })
  )
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  useEffect(() => () => later.cancel(), [later])

  function edit(next: string, immediate: boolean) {
    setText(next)
    setFileError(null)
    if (tooBig(new Blob([next]).size)) {
      later.cancel()
      setPending(false)
      setParsed(null)
      setFileError(`The script is over ${describeLimit()}.`)
      return
    }
    if (immediate) {
      later.cancel()
      setPending(false)
      setParsed(parse(next, readAs))
      return
    }
    setPending(true)
    later.run({ text: next, readAs })
  }

  function chooseReadAs(next: DialectId) {
    setReadAs(next)
    later.cancel()
    setPending(false)
    if (!fileError) setParsed(parse(text, next))
  }

  async function loadFile(file: File | undefined) {
    if (!file) return
    if (tooBig(file.size)) {
      later.cancel()
      setPending(false)
      setParsed(null)
      setFileError(`"${file.name}" is over ${describeLimit()}.`)
      return
    }
    edit(await file.text(), true)
  }

  // Closing the dialog itself (not unmounting it) lets the browser give the
  // focus back to the button that opened it.
  function close() {
    if (dialogRef.current) dialogRef.current.close()
    else onClose()
  }

  const summary = parsed ? summarize(parsed.result.schema) : null
  const errors = parsed?.result.errors ?? []
  const warnings = parsed?.result.warnings ?? []
  const canImport =
    !pending &&
    parsed !== null &&
    summary !== null &&
    errors.length === 0 &&
    !isEmptyImport(summary)
  const replacing = hasContent && mode === 'replace'

  function run() {
    if (!parsed || !canImport) return
    forgeStore
      .getState()
      .importSchema(parsed.result.schema, replacing ? 'replace' : 'add')
    close()
  }

  const shownWarnings = limitMessages(warnings, MAX_LISTED)
  const shownErrors = limitMessages(errors, MAX_LISTED)

  return (
    <dialog
      className='import-dialog'
      aria-label='Import SQL'
      ref={(element) => {
        dialogRef.current = element
        if (element && !element.open) element.showModal()
      }}
      onClose={onClose}>
      <h2 className='import-dialog__title'>Import SQL</h2>
      <p className='inspector__hint'>
        Paste a script or load a .sql file. Tables, columns, primary and foreign
        keys, indexes, comments, enums and domains are imported; anything else
        is listed below and skipped.
      </p>

      <label className='field'>
        SQL
        <textarea
          aria-label='SQL'
          className='import-dialog__text'
          rows={10}
          spellCheck={false}
          placeholder='CREATE TABLE users (id integer PRIMARY KEY, …);'
          value={text}
          onChange={(event) => edit(event.target.value, false)}
        />
      </label>
      <label className='field'>
        Read as
        <select
          aria-label='Read as'
          value={readAs}
          onChange={(event) => chooseReadAs(event.target.value as DialectId)}>
          {DIALECT_IDS.map((id) => (
            <option key={id} value={id}>
              {DIALECT_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <p className='inspector__hint'>
        Scripts are read as {DIALECT_LABELS[readAs]}.
      </p>

      <label className='field'>
        Or a file
        <input
          type='file'
          accept='.sql,text/plain'
          aria-label='SQL file'
          onChange={(event) => {
            const input = event.target
            const file = input.files?.[0]
            // Forget the file once it is taken: choosing the same one again,
            // after it changed on disk, is then a change the browser reports.
            input.value = ''
            loadFile(file)
          }}
        />
      </label>
      {fileError && (
        <p role='alert' className='import-dialog__error'>
          {fileError}
        </p>
      )}

      <section aria-label='Import preview' className='import-dialog__preview'>
        {pending && <p className='inspector__hint'>Updating the preview…</p>}
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

      {hasContent && (
        <fieldset className='import-dialog__mode'>
          <legend>The project already has content</legend>
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
        <button type='button' onClick={close}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}
