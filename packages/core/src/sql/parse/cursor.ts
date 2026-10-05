import type { DialectId } from '../../dialects/dialect.ts'
import type { Token } from './tokenize.ts'

/** A statement that cannot be read: it becomes an error with its line. */
export class ParseFailure extends Error {
  readonly line: number

  constructor(line: number, message: string) {
    super(message)
    this.line = line
  }
}

/** A position in the tokens of one statement, with the helpers a parser needs. */
export class Cursor {
  pos = 0

  readonly tokens: Token[]
  /** The database the script is written for: it decides how a plain name is folded. */
  readonly dialect: DialectId
  private readonly sql: string
  private readonly onWarn: (line: number, message: string) => void

  constructor(
    tokens: Token[],
    sql: string,
    onWarn: (line: number, message: string) => void,
    dialect: DialectId = 'postgres'
  ) {
    this.dialect = dialect
    this.tokens = tokens
    this.sql = sql
    this.onWarn = onWarn
  }

  get done(): boolean {
    return this.pos >= this.tokens.length
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  line(): number {
    return (this.peek() ?? this.tokens[this.tokens.length - 1])?.line ?? 1
  }

  next(): Token {
    const token = this.peek()
    if (!token) return this.fail('The statement ends too soon.')
    this.pos++
    return token
  }

  warn(message: string): void {
    this.onWarn(this.line(), message)
  }

  fail(message: string): never {
    throw new ParseFailure(this.line(), message)
  }

  isWord(...words: string[]): boolean {
    const token = this.peek()
    return token?.kind === 'word' && words.includes(token.value)
  }

  isSymbol(symbol: string, offset = 0): boolean {
    const token = this.peek(offset)
    return token?.kind === 'symbol' && token.value === symbol
  }

  acceptWord(...words: string[]): Token | null {
    if (!this.isWord(...words)) return null
    return this.next()
  }

  /** Accepts the words in order, or none of them. */
  acceptWords(...sequence: string[]): boolean {
    const matches = sequence.every((word, offset) => {
      const token = this.peek(offset)
      return token?.kind === 'word' && token.value === word
    })
    if (matches) this.pos += sequence.length
    return matches
  }

  expectWord(word: string): Token {
    return (
      this.acceptWord(word) ??
      this.fail(`Expected ${word.toUpperCase()}${this.found()}.`)
    )
  }

  acceptSymbol(symbol: string): boolean {
    if (!this.isSymbol(symbol)) return false
    this.pos++
    return true
  }

  expectSymbol(symbol: string): void {
    if (!this.acceptSymbol(symbol)) {
      this.fail(`Expected "${symbol}"${this.found()}.`)
    }
  }

  private found(): string {
    const token = this.peek()
    return token ? `, found "${token.text}"` : ' at the end of the statement'
  }

  /** A name: a bare word (folded as the dialect folds it) or a quoted identifier. */
  identifier(what: string): string {
    const token = this.peek()
    if (token?.kind === 'word' || token?.kind === 'ident') {
      this.pos++
      return token.kind === 'word' && this.dialect === 'oracle'
        ? token.text.toUpperCase()
        : token.value
    }
    return this.fail(`Expected ${what}${this.found()}.`)
  }

  /** `a`, `a.b` or `a.b.c`, as its parts. */
  dottedName(what: string): string[] {
    const parts = [this.identifier(what)]
    while (this.isSymbol('.')) {
      this.pos++
      parts.push(this.identifier(what))
    }
    return parts
  }

  /** A table or type name, with an optional schema that Forge does not keep. */
  qualifiedName(what: string): { name: string; schema?: string } {
    const parts = this.dottedName(what)
    const name = parts[parts.length - 1] as string
    const schema = parts.length > 1 ? parts[parts.length - 2] : undefined
    if (schema !== undefined && schema !== 'public') {
      this.warn(
        `Schema "${schema}" is ignored: "${name}" is imported without it.`
      )
    }
    return schema === undefined ? { name } : { name, schema }
  }

  /** At "(", moves past the matching ")". */
  skipBalanced(): void {
    this.expectSymbol('(')
    let depth = 1
    while (depth > 0) {
      const token = this.next()
      if (token.kind !== 'symbol') continue
      if (token.value === '(') depth++
      else if (token.value === ')') depth--
    }
  }

  /** The source text from token `from` up to (not including) token `to`. */
  slice(from: number, to: number): string {
    const first = this.tokens[from]
    const last = this.tokens[to - 1]
    return first && last ? this.sql.slice(first.start, last.end) : ''
  }
}
