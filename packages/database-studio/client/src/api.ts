export interface TableSummary {
  name: string;
  /** `null` when the server failed to count rows for this table. */
  rowCount: number | null;
  /** Server-reported error when the row count failed. */
  error?: string;
}

export interface ColumnSchema {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  defaultValue: string | null;
  primaryKey: number;
}

export interface TableSchema {
  columns: ColumnSchema[];
  foreignKeys: { from: string; table: string; to: string }[];
  indexes: { name: string; unique: number }[];
}

export interface RowsResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  pagination: {
    page: number;
    limit: number;
    totalRows: number;
    totalPages: number;
  };
  /** Client-measured response time in milliseconds. */
  responseTime: number;
}

const BASE = "";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    // Prefer the server's error message (`{ error: "..." }`) over the bare status.
    let message = `API error: ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // Body wasn't JSON — fall back to the status-based message.
    }
    throw new Error(message);
  }
  return res.json();
}

export function fetchTables(): Promise<TableSummary[]> {
  return fetchJson("/api/tables");
}

export function fetchTableSchema(name: string): Promise<TableSchema> {
  return fetchJson(`/api/tables/${encodeURIComponent(name)}/schema`);
}

export interface RowLookupResponse {
  row: Record<string, unknown>;
  columns: string[];
  schema: { name: string; type: string }[];
  foreignKeys: { from: string; table: string; to: string }[];
}

export function fetchRowLookup(
  table: string,
  column: string,
  value: string,
): Promise<RowLookupResponse> {
  return fetchJson(
    `/api/tables/${encodeURIComponent(table)}/lookup?column=${encodeURIComponent(column)}&value=${encodeURIComponent(value)}`,
  );
}

export interface FilterCondition {
  column: string;
  operator: string;
  value: string;
}

export type FilterMode = "and" | "or";

export async function fetchTableRows(
  name: string,
  page = 1,
  limit = 50,
  filters: FilterCondition[] = [],
  sort?: { column: string; order: "asc" | "desc" },
  filterMode: FilterMode = "and",
): Promise<RowsResponse> {
  const start = performance.now();
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.length > 0) {
    params.set("filters", JSON.stringify(filters));
    if (filterMode === "or") {
      params.set("filterMode", "or");
    }
  }
  if (sort) {
    params.set("sort", sort.column);
    params.set("order", sort.order);
  }
  const data = await fetchJson<Omit<RowsResponse, "responseTime">>(
    `/api/tables/${encodeURIComponent(name)}/rows?${params}`,
  );
  return { ...data, responseTime: Math.round(performance.now() - start) };
}
