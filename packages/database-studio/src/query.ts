import type { Database, SqlValue } from "@bunny.net/database-client";
import { DatabaseError } from "@bunny.net/database-client";

export type QueryClient = Pick<Database, "prepare">;

export interface QueryResult {
  columns: string[];
  /** Positional, so duplicate column names (`a.id`, `b.id`) both survive. */
  rows: SqlValue[][];
  truncated: boolean;
  durationMs: number;
}

export const MAX_ROWS = 1000;

const READ_KEYWORDS = new Set([
  "SELECT",
  "WITH",
  "EXPLAIN",
  "PRAGMA",
  "VALUES",
]);

// Writes that can follow a read keyword (`WITH … DELETE`); statement-initial words like BEGIN are caught by the first-keyword check.
const WRITE_KEYWORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "CREATE",
  "DROP",
  "ALTER",
]);

/** Read-only PRAGMAs that may take a table or index name. */
const SCHEMA_PRAGMAS = new Set([
  "table_info",
  "table_xinfo",
  "table_list",
  "index_list",
  "index_info",
  "index_xinfo",
  "foreign_key_list",
  "foreign_key_check",
  "integrity_check",
  "quick_check",
]);

/** PRAGMAs that read a setting only when they stand alone; an argument or `=` sets it. */
const STATUS_PRAGMAS = new Set([
  "compile_options",
  "database_list",
  "function_list",
  "module_list",
  "pragma_list",
  "collation_list",
  "user_version",
  "schema_version",
  "application_id",
  "page_count",
  "page_size",
  "freelist_count",
  "data_version",
  "encoding",
  "journal_mode",
  "foreign_keys",
]);

/** A query studio won't run; the message is safe to show as-is. */
export class QueryRejected extends Error {}

/** The SQL with comments, strings, and quoted identifiers blanked out. */
function codeOnly(sql: string): string {
  return sql.replace(
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]/g,
    " ",
  );
}

function firstKeyword(sql: string): string | null {
  return (
    codeOnly(sql)
      .trim()
      .match(/^[A-Za-z]+/)?.[0]
      ?.toUpperCase() ?? null
  );
}

/** Why studio won't run this statement, or null when it may. */
export function rejectionReason(statement: string): string | null {
  const code = codeOnly(statement);
  const keyword = firstKeyword(statement);

  if (!keyword || !READ_KEYWORDS.has(keyword)) {
    return "Studio is read-only: only SELECT, WITH, EXPLAIN, PRAGMA, and VALUES statements run here.";
  }

  if (keyword === "PRAGMA") {
    const match = code.match(/^\s*PRAGMA\s+(?:\w+\s*\.\s*)?(\w+)\s*(.*)$/is);
    const name = match?.[1]?.toLowerCase() ?? "";
    const rest = (match?.[2] ?? "").trim();
    const argOk = /^(\(\s*\)|\([^=()]*\))?$/.test(rest);
    const allowed =
      (SCHEMA_PRAGMAS.has(name) && argOk) ||
      (STATUS_PRAGMAS.has(name) && rest === "");
    return allowed
      ? null
      : `Studio only runs PRAGMAs that read, such as table_info(name) or user_version on its own. PRAGMA ${name || "?"} as written could change a setting.`;
  }

  if (code.includes(";")) {
    return "Run one statement at a time: select it, or put the cursor in it, and press Run.";
  }

  // `REPLACE(...)` is the string function; `REPLACE INTO` is a write.
  for (const match of code.matchAll(/[A-Za-z_][A-Za-z0-9_$]*/g)) {
    const word = match[0].toUpperCase();
    if (!WRITE_KEYWORDS.has(word)) continue;
    const after = code.slice(match.index + word.length);
    if (word === "REPLACE" && /^\s*\(/.test(after)) {
      continue;
    }
    return `Studio is read-only, and this statement contains ${word}, which writes.`;
  }

  return null;
}

/** libSQL treats some read-only PRAGMAs as writes, so run them in their table-valued SELECT form. */
export function pragmaAsSelect(statement: string): string | null {
  const match = statement.match(
    /^\s*PRAGMA\s+(?:(\w+)\s*\.\s*)?(\w+)\s*(?:\((.*)\))?\s*;?\s*$/is,
  );
  if (!match) return null;
  const [, schema, name, rawArg = ""] = match;
  const arg = unquote(rawArg.trim());
  const args = [...(arg ? [arg] : []), ...(schema ? [schema] : [])].map(
    (a) => `'${a.replace(/'/g, "''")}'`,
  );
  return `SELECT * FROM pragma_${name?.toLowerCase()}(${args.join(", ")})`;
}

/** A quoted SQL name or string as its plain text: `"a""b"` → `a"b`, `'o''b'` → `o'b`. */
function unquote(text: string): string {
  const quote = text[0];
  if (text.length >= 2 && (quote === '"' || quote === "'" || quote === "`")) {
    if (text.endsWith(quote)) {
      return text.slice(1, -1).replaceAll(quote + quote, quote);
    }
  }
  if (text.startsWith("[") && text.endsWith("]")) return text.slice(1, -1);
  return text;
}

/** Runs one console statement; writes are refused here and, with a CLI-created token, by the server too. */
export async function runReadOnlyQuery(
  client: QueryClient,
  sql: string,
): Promise<QueryResult> {
  const statement = sql.trim().replace(/;\s*$/, "");
  if (!statement) throw new QueryRejected("Enter a query to run.");

  const reason = rejectionReason(statement);
  if (reason) throw new QueryRejected(reason);

  const runnable =
    firstKeyword(statement) === "PRAGMA"
      ? (pragmaAsSelect(statement) ?? statement)
      : statement;
  const start = performance.now();
  const result = await client.prepare(runnable).runRaw();
  const durationMs = Math.round(performance.now() - start);

  return {
    columns: result.columns,
    rows: result.rows.slice(0, MAX_ROWS),
    truncated: result.rows.length > MAX_ROWS,
    durationMs,
  };
}

const AUTH_ERROR =
  /not authori[sz]ed|unauthori[sz]ed|forbidden|permission|read.?only|readonly/i;

/** A message safe to show in the browser, or null to log the error and show a generic one. */
export function queryErrorMessage(err: unknown): string | null {
  if (err instanceof QueryRejected) return err.message;
  if (!(err instanceof DatabaseError)) return null;

  if (err.status === 401) {
    return "The database rejected studio's token. Generated tokens expire after a while; restart `bunny db studio` to get a new one.";
  }
  if (
    err.status === 403 ||
    AUTH_ERROR.test(err.message) ||
    AUTH_ERROR.test(err.code ?? "")
  ) {
    return "The database refused this statement: studio's token is read-only, and the server treats the statement as a write.";
  }
  if (err.status === undefined) return err.message;
  return null;
}
