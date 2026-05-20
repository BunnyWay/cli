/**
 * Minimal `.env` parser.
 *
 * Handles:
 * - `KEY=value`
 * - `KEY="quoted value"` / `KEY='quoted value'` (quotes stripped)
 * - leading `export KEY=...` (the line still parses as KEY=...)
 * - comments starting with `#`
 * - blank lines
 *
 * Deliberately does *not* expand variable references (`$OTHER`), since
 * we don't run user-supplied shell semantics inside our config layer.
 */
export function parseDotenv(input: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;

    const eq = stripped.indexOf("=");
    if (eq < 1) continue;

    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = stripped.slice(eq + 1).trim();

    // Strip a trailing inline comment when the value is unquoted.
    if (!isQuoted(value)) {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    } else {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function isQuoted(value: string): boolean {
  if (value.length < 2) return false;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'");
}
