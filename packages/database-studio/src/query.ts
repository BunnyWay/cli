import type { Database, SqlValue } from "@bunny.net/database-client";
import { DatabaseError } from "@bunny.net/database-client";

export type QueryClient = Pick<Database, "prepare" | "batchRaw">;

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

/** A query studio won't run; the message is safe to show as-is. */
export class QueryRejected extends Error {}

/** The first keyword after any leading whitespace and comments. */
export function firstKeyword(sql: string): string | null {
  const stripped = sql.replace(
    /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/,
    "",
  );
  return stripped.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? null;
}

/**
 * Run one statement with writes refused at three layers: the keyword
 * allowlist rejects obvious writes with a clear message; `PRAGMA query_only`
 * makes SQLite refuse any write the statement turns out to make (a CTE that
 * ends in DELETE, a PRAGMA that sets a value); and the studio token is
 * read-only when the CLI generated it. `batchRaw()` runs the pragma and the
 * statement on one connection that closes with the request, so the pragma
 * can't leak into other queries.
 */
export async function runReadOnlyQuery(
  client: QueryClient,
  sql: string,
): Promise<QueryResult> {
  const statement = sql.trim().replace(/;\s*$/, "");
  if (!statement) throw new QueryRejected("Enter a query to run.");

  const keyword = firstKeyword(statement);
  if (!keyword || !READ_KEYWORDS.has(keyword)) {
    throw new QueryRejected(
      "Studio is read-only: only SELECT, WITH, EXPLAIN, PRAGMA, and VALUES statements run here.",
    );
  }

  const start = performance.now();
  const [, result] = await client.batchRaw([
    client.prepare("PRAGMA query_only = ON"),
    client.prepare(statement),
  ]);
  const durationMs = Math.round(performance.now() - start);
  const rows = result?.rows ?? [];

  return {
    columns: result?.columns ?? [],
    rows: rows.slice(0, MAX_ROWS),
    truncated: rows.length > MAX_ROWS,
    durationMs,
  };
}

/**
 * The message to show the person who typed the query. SQL errors (syntax,
 * unknown column, refused write) are about their own query, so they're shown;
 * anything else stays generic and goes to the terminal.
 */
export function queryErrorMessage(err: unknown): string | null {
  if (err instanceof QueryRejected) return err.message;
  if (err instanceof DatabaseError && err.status === undefined) {
    if (/readonly|read-only|query_only/i.test(err.message)) {
      return "Studio is read-only, so SQLite refused a statement that writes.";
    }
    return err.message;
  }
  return null;
}
