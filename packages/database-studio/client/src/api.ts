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

export interface StudioSchema {
  /** Which database is open, e.g. `db_… (host)`. */
  label: string | null;
  readOnly: boolean;
  tables: TableDefinition[];
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

async function request(url: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal, credentials: "same-origin" });
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
  params.set(column, `eq.${String(value)}`);
  const res = await request(`/api/${encodeURIComponent(table)}?${params}`);
  const body = (await res.json()) as { data: Row[] };
  return body.data[0] ?? null;
}
