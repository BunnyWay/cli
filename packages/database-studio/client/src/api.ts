// OpenAPI spec types (subset we use)
interface OpenAPISpec {
  paths: Record<string, unknown>;
  components: {
    schemas: Record<
      string,
      {
        type?: string;
        properties?: Record<
          string,
          {
            type?: string;
            format?: string;
            nullable?: boolean;
            example?: unknown;
          }
        >;
        required?: string[];
      }
    >;
  };
}

export interface TableSummary {
  name: string;
}

export interface ColumnSchema {
  name: string;
  type: string;
  notnull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
  nullable: boolean;
}

export interface TableSchema {
  columns: ColumnSchema[];
  foreignKeys: { from: string; table: string; to: string }[];
  indexes: { name: string; unique: boolean }[];
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
  responseTime: number;
}

const BASE = "";

let cachedSpec: OpenAPISpec | null = null;

const fetchSpec = async (): Promise<OpenAPISpec> => {
  if (cachedSpec) return cachedSpec;
  const res = await fetch(`${BASE}/api/`);
  if (!res.ok) throw new Error(`Failed to load API spec: ${res.status}`);
  const spec: OpenAPISpec = await res.json();
  cachedSpec = spec;
  return spec;
};

export const fetchTables = async (): Promise<TableSummary[]> => {
  const spec = await fetchSpec();
  // Extract table names from paths - each /{table} path is a table
  const tables: TableSummary[] = [];
  for (const path of Object.keys(spec.paths)) {
    // Match /{tableName} but not /{tableName}/{id} or /{tableName}/by-*
    const match = path.match(/^\/([^/]+)$/);
    if (match?.[1]) {
      tables.push({ name: match[1] });
    }
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchTableSchema = async (name: string): Promise<TableSchema> => {
  const spec = await fetchSpec();
  const tableSchema = spec.components.schemas[name];
  if (!tableSchema?.properties) {
    throw new Error(`Schema not found for table: ${name}`);
  }

  // Build columns from the OpenAPI schema
  const insertSchema = spec.components.schemas[`${name}Insert`];
  const required = new Set(tableSchema.required ?? []);
  const insertProps = new Set(Object.keys(insertSchema?.properties ?? {}));

  const columns: ColumnSchema[] = Object.entries(tableSchema.properties).map(
    ([colName, colSchema]) => {
      // A column is a PK if it's in the base schema but not in the insert schema
      // (INTEGER PKs are auto-increment and excluded from insert)
      const isPk = !insertProps.has(colName);

      return {
        name: colName,
        type: mapOpenAPIType(colSchema.type, colSchema.format),
        notnull: !colSchema.nullable && required.has(colName),
        defaultValue: null,
        primaryKey: isPk,
        nullable: colSchema.nullable ?? false,
      };
    },
  );

  // Foreign keys and indexes aren't in the OpenAPI spec - return empty for now
  // The schema tab will show what's available from the spec
  return {
    columns,
    foreignKeys: [],
    indexes: [],
  };
};

const mapOpenAPIType = (type?: string, format?: string): string => {
  if (type === "integer") return "INTEGER";
  if (type === "number") return "REAL";
  if (type === "boolean") return "BOOLEAN";
  if (type === "string" && format === "date-time") return "DATETIME";
  if (type === "string" && format === "binary") return "BLOB";
  if (type === "string") return "TEXT";
  return type ?? "TEXT";
};

export interface RowLookupResponse {
  row: Record<string, unknown>;
  columns: string[];
  schema: { name: string; type: string }[];
  foreignKeys: { from: string; table: string; to: string }[];
}

export const fetchRowLookup = async (
  table: string,
  column: string,
  value: string,
): Promise<RowLookupResponse> => {
  const res = await fetch(
    `${BASE}/api/${encodeURIComponent(table)}?${column}=eq.${encodeURIComponent(value)}&limit=1`,
  );
  if (!res.ok) throw new Error(`Lookup failed: ${res.status}`);
  const body = await res.json();
  const rows = body.data as Record<string, unknown>[];
  const [row] = rows;
  if (!row) throw new Error("Row not found");

  const tableSchema = await fetchTableSchema(table);

  return {
    row,
    columns: Object.keys(row),
    schema: tableSchema.columns.map((c) => ({ name: c.name, type: c.type })),
    foreignKeys: tableSchema.foreignKeys,
  };
};

export interface FilterCondition {
  column: string;
  operator: string;
  value: string;
}

export type FilterMode = "and" | "or";

// Map studio UI operators to PostgREST query param format
const mapFilter = (f: FilterCondition): [string, string] => {
  switch (f.operator) {
    case "=":
      return [f.column, `eq.${f.value}`];
    case "!=":
      return [f.column, `neq.${f.value}`];
    case ">":
      return [f.column, `gt.${f.value}`];
    case "<":
      return [f.column, `lt.${f.value}`];
    case ">=":
      return [f.column, `gte.${f.value}`];
    case "<=":
      return [f.column, `lte.${f.value}`];
    case "LIKE":
      return [f.column, `like.${f.value}`];
    case "NOT LIKE":
      return [f.column, `neq.${f.value}`]; // approximate
    case "IS NULL":
      return [f.column, "is.null"];
    case "IS NOT NULL":
      // Use neq approach - filter where column is not null
      return [f.column, `neq.`]; // We'll handle this specially
    default:
      return [f.column, `eq.${f.value}`];
  }
};

export const fetchTableRows = async (
  name: string,
  page = 1,
  limit = 50,
  filters: FilterCondition[] = [],
  sort?: { column: string; order: "asc" | "desc" },
  _filterMode: FilterMode = "and",
): Promise<RowsResponse> => {
  const start = performance.now();
  const offset = (page - 1) * limit;

  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  if (sort) {
    params.set("order", `${sort.column}.${sort.order}`);
  }

  for (const f of filters) {
    // Handle IS NOT NULL specially - the rest handler doesn't have a "not null" operator,
    // but we can skip it or handle it via is.false workaround
    if (f.operator === "IS NULL") {
      params.append(f.column, "is.null");
    } else if (f.operator === "IS NOT NULL") {
      // No direct PostgREST equivalent for IS NOT NULL - skip for now
      // TODO: Add "not" operator support to database-rest
    } else {
      const [key, value] = mapFilter(f);
      params.append(key, value);
    }
  }

  const res = await fetch(`${BASE}/api/${encodeURIComponent(name)}?${params}`);
  if (!res.ok) {
    let message = `API error: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {}
    throw new Error(message);
  }

  const body = await res.json();
  const totalRows = Number(res.headers.get("X-Total-Count") ?? 0);
  const rows = body.data as Record<string, unknown>[];
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return {
    columns,
    rows,
    pagination: {
      page,
      limit,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / limit)),
    },
    responseTime: Math.round(performance.now() - start),
  };
};
