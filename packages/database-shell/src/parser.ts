/** Statements whose body is a `BEGIN ... END` block, so inner semicolons don't terminate them. */
const BLOCK_BODY_START = /^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i;

/** True when `current` opens a `BEGIN ... END` block that hasn't been closed yet. */
function inBlockBody(current: string): boolean {
  const trimmed = current.trim();
  if (!BLOCK_BODY_START.test(trimmed)) return false;
  return !/\bEND$/i.test(trimmed);
}

/**
 * Split a SQL string into individual statements, handling single-quoted strings
 * and `--` line comments. Trims whitespace and filters empty results.
 *
 * `CREATE TRIGGER` bodies are kept intact: semicolons inside `BEGIN ... END`
 * don't split the statement.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === undefined) break;

    // Handle -- line comments (only outside strings)
    if (!inString && ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      current += "\n";
      continue;
    }

    if (ch === "'") {
      if (inString) {
        // '' is an escaped quote inside a string, not end of string
        if (sql[i + 1] === "'") {
          current += "''";
          i++;
          continue;
        }
        inString = false;
      } else {
        inString = true;
      }
      current += ch;
      continue;
    }

    if (ch === ";" && !inString) {
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

  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);

  return statements;
}
