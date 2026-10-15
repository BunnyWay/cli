import type {
  ColumnDefinition,
  TableDefinition,
} from "@bunny.net/database-openapi";
import {
  type FilterCondition,
  type FilterMode,
  filterParams,
} from "@/lib/filters";

export type { ColumnDefinition, TableDefinition };

export type Row = Record<string, unknown>;

export interface ViewDefinition {
  name: string;
  sql: string | null;
  columns: string[];
}

export interface StudioSchema {
  /** Which database is open, e.g. `db_… (host)`. */
  label: string | null;
  /** The database token itself is read-only (studio created it), not just studio's checks. */
  tokenReadOnly: boolean;
  tables: TableDefinition[];
  /** Each table's CREATE statements: the table, then its indexes and triggers. */
  ddl: Record<string, string[]>;
  views: ViewDefinition[];
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  /** The server stopped at its row cap. */
  truncated: boolean;
  durationMs: number;
}

export interface RowsQuery {
  page: number;
  limit: number;
  filters: FilterCondition[];
  mode: FilterMode;
  sort?: { column: string; order: "asc" | "desc" };
}

export interface RowsResponse {
  rows: Row[];
  totalRows: number;
  totalPages: number;
  responseTime: number;
}

async function request(
  url: string,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, { ...init, signal, credentials: "same-origin" });
  if (res.ok) return res;

  if (res.status === 401) {
    throw new Error(
      "This studio session has expired. Run `bunny db studio` again to reconnect.",
    );
  }
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (body?.message) message = body.message;
  } catch {}
  throw new Error(message);
}

export async function fetchSchema(): Promise<StudioSchema> {
  const res = await request("/studio-api/schema");
  return res.json();
}

export async function fetchRows(
  table: string,
  query: RowsQuery,
  signal?: AbortSignal,
): Promise<RowsResponse> {
  const start = performance.now();
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  params.set("offset", String((query.page - 1) * query.limit));
  if (query.sort) {
    params.set("order", `${query.sort.column}.${query.sort.order}`);
  }
  for (const [key, value] of filterParams(query.filters, query.mode)) {
    params.append(key, value);
  }

  const res = await request(
    `/api/${encodeURIComponent(table)}?${params}`,
    signal,
  );
  const body = (await res.json()) as { data: Row[] };
  const totalRows = Number(res.headers.get("X-Total-Count") ?? 0);

  return {
    rows: body.data,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / query.limit)),
    responseTime: Math.round(performance.now() - start),
  };
}

/** The first row where `column` equals `value`, or null; used to follow foreign keys. */
export async function fetchRowWhere(
  table: string,
  column: string,
  value: unknown,
): Promise<Row | null> {
  const params = new URLSearchParams({ limit: "1" });
  for (const [key, v] of filterParams(
    [{ column, operator: "eq", value: String(value) }],
    "and",
  )) {
    params.append(key, v);
  }
  const res = await request(`/api/${encodeURIComponent(table)}?${params}`);
  const body = (await res.json()) as { data: Row[] };
  return body.data[0] ?? null;
}

/** Run one read-only statement in the SQL console. */
export async function runQuery(
  sql: string,
  signal?: AbortSignal,
): Promise<QueryResult> {
  const res = await request("/studio-api/query", signal, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  return res.json();
}
