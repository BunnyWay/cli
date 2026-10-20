// Lets Cmd+Enter run the statement under the cursor; skips semicolons in quotes and comments.
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
  if (!statement && start > 0) return statementAt(doc, start - 1);
  return statement;
}

// Always quoted: a bare name can be a keyword (`order`, `group`).
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
