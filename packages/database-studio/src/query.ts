import type { Database, SqlValue } from "@bunny.net/database-client";
import { DatabaseError } from "@bunny.net/database-client";

export type QueryClient = Pick<Database, "prepare">;

export interface QueryResult {
  columns: string[];
  /** Positional, so duplicate column names (`a.id`, `b.id`) both survive. */
  rows: SqlValue[][];
  /** True when the query returned more than `MAX_ROWS` rows and the rest were dropped. */
  truncated: boolean;
  durationMs: number;
}

/** Rows sent to the browser per query; the console says when a result was cut. */
export const MAX_ROWS = 1000;

const READ_KEYWORDS = new Set([
  "SELECT",
  "WITH",
  "EXPLAIN",
  "PRAGMA",
  "VALUES",
]);

/** Keywords that only appear in statements that change something. */
const WRITE_KEYWORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "UPSERT",
  "CREATE",
  "DROP",
  "ALTER",
  "ATTACH",
  "DETACH",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
]);

/** PRAGMAs that read schema and may name a table or index: `PRAGMA table_info(users)`. */
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

/** PRAGMAs that report a setting; with an argument or `=` they'd change it, so they must stand alone. */
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

/**
 * The SQL with comments, string literals, and quoted identifiers blanked
 * out, so keyword checks only see the statement's own words.
 */
function codeOnly(sql: string): string {
  return sql.replace(
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]/g,
    " ",
  );
}

/** The first keyword after any leading whitespace and comments. */
export function firstKeyword(sql: string): string | null {
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

  // `REPLACE(...)` is the string function; `REPLACE INTO` is a write.
  for (const match of code.matchAll(/[A-Za-z_]+/g)) {
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

/**
 * `PRAGMA name(arg)` as `SELECT * FROM pragma_name('arg')`. libSQL servers
 * classify some read-only PRAGMAs (foreign_key_list, user_version) as
 * writes, so a read-only token can't run them, but the table-valued form is a
 * SELECT. Only called for PRAGMAs `rejectionReason()` already allowed.
 */
export function pragmaAsSelect(statement: string): string | null {
  const match = codeOnly(statement).match(
    /^\s*PRAGMA\s+(?:\w+\s*\.\s*)?(\w+)\s*(?:\(\s*([^()]*?)\s*\))?\s*$/i,
  );
  if (!match) return null;
  const name = match[1]?.toLowerCase();
  // The argument was blanked out if it was quoted, so read it from the original.
  const raw = statement.match(/\(\s*([^()]*?)\s*\)\s*;?\s*$/)?.[1] ?? "";
  const arg = raw
    .replace(/^(['"`])(.*)\1$/s, "$2")
    .replace(/^\[(.*)\]$/s, "$1");
  return `SELECT * FROM pragma_${name}(${arg ? `'${arg.replace(/'/g, "''")}'` : ""})`;
}

/**
 * Run one statement from the SQL console. Writes are stopped at two layers:
 * studio rejects statements that contain write keywords, and a libSQL
 * server refuses anything its parser classifies as a write when the token is
 * read-only, which it is whenever studio created the token. (SQLite's
 * `PRAGMA query_only` would be a neater guard, but libSQL servers reject
 * that statement outright.)
 */
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

/**
 * The message to show the person who typed the query. SQL errors (syntax,
 * unknown column) are about their own query, so they're shown; scope and
 * token failures get an explanation; anything else stays generic and goes to
 * the terminal.
 */
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
