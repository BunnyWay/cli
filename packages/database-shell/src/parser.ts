/** Statements whose body is a `BEGIN ... END` block, so inner semicolons don't terminate them. */
const BLOCK_BODY_START = /^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i;

type QuoteTerminator = "'" | '"' | "`" | "]";

function syntaxError(sql: string, offset: number, message: string): Error {
  const before = sql.slice(0, offset);
  const line = (before.match(/\n/g)?.length ?? 0) + 1;
  const lastNewline = before.lastIndexOf("\n");
  const column = offset - lastNewline;
  return new Error(`${message} at line ${line}, column ${column}.`);
}

/** Replace quoted strings and identifiers with a space so keywords inside them don't affect nesting; shares the quote rules of `splitStatements`. */
function stripQuoted(sql: string): string {
  let out = "";
  let quote: QuoteTerminator | undefined;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === undefined) break;

    if (quote) {
      if (ch !== quote) continue;
      if (quote !== "]" && sql[i + 1] === quote) {
        i++;
        continue;
      }
      quote = undefined;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      quote = ch === "[" ? "]" : ch;
      out += " ";
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * True when `current` opens a `BEGIN ... END` block that hasn't been closed yet.
 *
 * `BEGIN` opens the trigger body and `CASE` opens an expression; both are closed
 * by `END`, so the body ends only once every opener has been matched. Counting
 * rather than checking for a trailing `END` is what keeps a body statement like
 * `SET x = CASE ... END;` from being mistaken for the end of the trigger.
 */
function inBlockBody(current: string): boolean {
  const trimmed = current.trim();
  if (!BLOCK_BODY_START.test(trimmed)) return false;

  const bare = stripQuoted(trimmed);
  const openers = (bare.match(/\b(?:BEGIN|CASE)\b/gi) ?? []).length;
  const closers = (bare.match(/\bEND\b/gi) ?? []).length;

  return closers < openers;
}

/**
 * Split a SQL string into individual statements, handling SQLite strings,
 * quoted identifiers, and both `--` line and block comments. Trims whitespace
 * and filters empty results. Comments are dropped, so a `;` or quote inside one
 * is inert. Unterminated quotes and block comments are rejected instead of
 * silently truncating a migration.
 *
 * `CREATE TRIGGER` bodies are kept intact: semicolons inside `BEGIN ... END`
 * don't split the statement.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: QuoteTerminator | undefined;
  let quoteStart = -1;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === undefined) break;

    if (quote) {
      current += ch;
      if (ch !== quote) continue;

      // SQLite escapes string, double-quote, and backtick delimiters by
      // doubling them. Bracket identifiers end at the first closing bracket.
      if (quote !== "]" && sql[i + 1] === quote) {
        current += quote;
        i++;
        continue;
      }

      quote = undefined;
      quoteStart = -1;
      continue;
    }

    // Handle -- line comments (only outside quotes)
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      current += "\n";
      continue;
    }

    // Handle /* */ block comments (only outside quotes)
    if (ch === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      if (close === -1) {
        throw syntaxError(sql, i, "Unterminated block comment");
      }
      i = close + 1;
      current += " ";
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      quoteStart = i;
      current += ch;
      continue;
    }

    if (ch === "[") {
      quote = "]";
      quoteStart = i;
      current += ch;
      continue;
    }

    if (ch === ";") {
      if (inBlockBody(current)) {
        current += ch;
        continue;
      }
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  if (quote) {
    throw syntaxError(sql, quoteStart, "Unterminated quoted value");
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);

  return statements;
}
