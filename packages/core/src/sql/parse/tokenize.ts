export type TokenKind = 'word' | 'ident' | 'string' | 'number' | 'symbol'

export interface Token {
  kind: TokenKind
  /** The source text. */
  text: string
  /**
   * Words are lower-cased, quoted identifiers unquoted, strings decoded;
   * numbers and symbols are their text.
   */
  value: string
  line: number
  start: number
  end: number
}

export interface LexError {
  line: number
  message: string
}

export interface Statement {
  tokens: Token[]
  line: number
  text: string
}

const isDigit = (c: string | undefined): boolean =>
  c !== undefined && c >= '0' && c <= '9'
const isWordStart = (c: string | undefined): boolean =>
  c !== undefined && (/[A-Za-z_]/.test(c) || c > '\u007f')
const isWordPart = (c: string | undefined): boolean =>
  c !== undefined && (/[A-Za-z0-9_$]/.test(c) || c > '\u007f')

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
}

export function tokenize(sql: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = []
  const errors: LexError[] = []
  const length = sql.length
  let i = 0
  let line = 1
  let first: Token | undefined
  let sawStdin = false

  const countLines = (from: number, to: number) => {
    for (let at = from; at < to; at++) if (sql[at] === '\n') line++
  }
  const push = (
    kind: TokenKind,
    start: number,
    end: number,
    value: string,
    startLine: number
  ) => {
    const previous = tokens[tokens.length - 1]
    const token: Token = {
      kind,
      text: sql.slice(start, end),
      value,
      line: startLine,
      start,
      end,
    }
    tokens.push(token)
    first ??= token
    if (kind === 'word' && value === 'stdin' && previous?.value === 'from') {
      sawStdin = true
    }
    return token
  }

  while (i < length) {
    const c = sql[i] as string

    if (c === '\n') {
      line++
      i++
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (
      c === '\\' &&
      /^[ \t]*$/.test(sql.slice(sql.lastIndexOf('\n', i - 1) + 1, i))
    ) {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? length : end
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? length : end
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const startLine = line
      let depth = 1
      let at = i + 2
      while (at < length && depth > 0) {
        if (sql[at] === '/' && sql[at + 1] === '*') {
          depth++
          at += 2
        } else if (sql[at] === '*' && sql[at + 1] === '/') {
          depth--
          at += 2
        } else {
          if (sql[at] === '\n') line++
          at++
        }
      }
      if (depth > 0) {
        errors.push({ line: startLine, message: 'A comment is never closed.' })
        i = length
      } else {
        i = at
      }
      continue
    }

    const startLine = line
    const start = i

    // 'text' and E'text'
    const escapeString =
      (c === 'E' || c === 'e') && sql[i + 1] === "'" && !isWordPart(sql[i - 1])
    if (c === "'" || escapeString) {
      let at = escapeString ? i + 2 : i + 1
      let value = ''
      let closed = false
      while (at < length) {
        const d = sql[at] as string
        if (d === "'" && sql[at + 1] === "'") {
          value += "'"
          at += 2
        } else if (d === "'") {
          closed = true
          at++
          break
        } else if (escapeString && d === '\\' && at + 1 < length) {
          const next = sql[at + 1] as string
          value += ESCAPES[next] ?? next
          at += 2
        } else {
          if (d === '\n') line++
          value += d
          at++
        }
      }
      if (!closed) {
        errors.push({ line: startLine, message: 'A string is never closed.' })
        i = length
        continue
      }
      push('string', start, at, value, startLine)
      i = at
      continue
    }

    // "identifier"
    if (c === '"') {
      let at = i + 1
      let value = ''
      let closed = false
      while (at < length) {
        const d = sql[at] as string
        if (d === '"' && sql[at + 1] === '"') {
          value += '"'
          at += 2
        } else if (d === '"') {
          closed = true
          at++
          break
        } else {
          if (d === '\n') line++
          value += d
          at++
        }
      }
      if (!closed) {
        errors.push({
          line: startLine,
          message: 'A quoted name is never closed.',
        })
        i = length
        continue
      }
      push('ident', start, at, value, startLine)
      i = at
      continue
    }

    // $tag$ … $tag$
    if (c === '$') {
      const open = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64))
      if (open) {
        const tag = open[0]
        const close = sql.indexOf(tag, i + tag.length)
        if (close === -1) {
          errors.push({
            line: startLine,
            message: 'A $-quoted string is never closed.',
          })
          i = length
          continue
        }
        const value = sql.slice(i + tag.length, close)
        countLines(i, close)
        push('string', start, close + tag.length, value, startLine)
        i = close + tag.length
        continue
      }
    }

    if (isDigit(c) || (c === '.' && isDigit(sql[i + 1]))) {
      let at = i
      while (isDigit(sql[at])) at++
      if (sql[at] === '.' && isDigit(sql[at + 1] ?? '')) {
        at++
        while (isDigit(sql[at])) at++
      } else if (sql[at] === '.' && at > i && !isWordStart(sql[at + 1])) {
        at++
      }
      if (
        (sql[at] === 'e' || sql[at] === 'E') &&
        (isDigit(sql[at + 1]) ||
          ((sql[at + 1] === '-' || sql[at + 1] === '+') &&
            isDigit(sql[at + 2])))
      ) {
        at += 2
        while (isDigit(sql[at])) at++
      }
      push('number', start, at, sql.slice(start, at), startLine)
      i = at
      continue
    }

    if (isWordStart(c)) {
      let at = i + 1
      while (isWordPart(sql[at])) at++
      const text = sql.slice(start, at)
      push('word', start, at, text.toLowerCase(), startLine)
      i = at
      continue
    }

    if (c === ':' && sql[i + 1] === ':') {
      push('symbol', start, i + 2, '::', startLine)
      i += 2
      continue
    }

    push('symbol', start, i + 1, c, startLine)
    i++

    // After `COPY … FROM stdin;` the lines up to `\.` are data, not SQL.
    if (c === ';') {
      if (first?.value === 'copy' && sawStdin) {
        const end = sql.indexOf('\n\\.', i)
        if (end === -1) {
          errors.push({
            line,
            message: 'COPY data is never ended by a line with "\\.".',
          })
        }
        const stop = end === -1 ? length : end + 3
        countLines(i, stop)
        i = stop
      }
      first = undefined
      sawStdin = false
    }
  }
  return { tokens, errors }
}

export function splitStatements(sql: string, tokens: Token[]): Statement[] {
  const statements: Statement[] = []
  let current: Token[] = []
  const finish = () => {
    const firstToken = current[0]
    const lastToken = current[current.length - 1]
    if (firstToken && lastToken) {
      statements.push({
        tokens: current,
        line: firstToken.line,
        text: sql.slice(firstToken.start, lastToken.end),
      })
    }
    current = []
  }
  for (const token of tokens) {
    if (token.kind === 'symbol' && token.value === ';') finish()
    else current.push(token)
  }
  finish()
  return statements
}
