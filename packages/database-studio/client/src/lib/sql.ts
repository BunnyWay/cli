/**
 * The statement around `pos`: the text between the semicolons on either side,
 * ignoring semicolons inside quotes and comments. Lets Cmd+Enter run the
 * statement under the cursor when the editor holds several.
 */
export function statementAt(doc: string, pos: number): string {
  const bounds: number[] = [];
  let quote: string | null = null;
  let comment: "line" | "block" | null = null;

  for (let i = 0; i < doc.length; i++) {
    const ch = doc[i];
    const next = doc[i + 1];
    if (comment === "line") {
      if (ch === "\n") comment = null;
    } else if (comment === "block") {
      if (ch === "*" && next === "/") {
        comment = null;
        i++;
      }
    } else if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === "-" && next === "-") {
      comment = "line";
    } else if (ch === "/" && next === "*") {
      comment = "block";
    } else if (ch === ";") {
      bounds.push(i);
    }
  }

  // A cursor right after a semicolon belongs to the statement it ends.
  let start = 0;
  let end = doc.length;
  for (const b of bounds) {
    if (b < pos - 1) {
      start = b + 1;
    } else {
      end = b;
      break;
    }
  }
  const statement = doc.slice(start, end).trim();
  // The cursor on a blank line after the last statement means that statement.
  if (!statement && start > 0) return statementAt(doc, start - 1);
  return statement;
}

export function quoteIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    ? name
    : `"${name.replace(/"/g, '""')}"`;
}
