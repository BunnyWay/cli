import type { DatabaseSchema, GenerateOptions } from "@bunny.net/database-openapi";
import { generateOpenAPISpec } from "@bunny.net/database-openapi";
import type { DatabaseExecutor } from "./executor.ts";
import { parseQueryParams } from "./parser.ts";
import {
  buildCountQuery,
  buildDeleteQuery,
  buildInsertQuery,
  buildSelectQuery,
  buildUpdateQuery,
} from "./sql.ts";

export interface RestHandlerOptions {
  /** Base path prefix to strip before routing (e.g. "/api"). Defaults to none. */
  basePath?: string;
  /** Options passed to generateOpenAPISpec for the root endpoint. */
  openapi?: GenerateOptions;
}

const json = (data: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const errorResponse = (message: string, status: number, code?: string) =>
  json({ message, ...(code ? { code } : {}) }, status);

interface CollectionRoute {
  kind: "collection";
  table: string;
}

interface SingleResourceRoute {
  kind: "single";
  table: string;
  column: string;
  value: string;
}

type ParsedRoute = CollectionRoute | SingleResourceRoute;

const parseRoute = (pathname: string, tableNames: Set<string>): ParsedRoute | null => {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length === 0) return null;

  const table = segments[0]!;
  if (!tableNames.has(table)) return null;

  // /{table}
  if (segments.length === 1) {
    return { kind: "collection", table };
  }

  // /{table}/by-{column}/{value}
  if (segments.length === 3 && segments[1]!.startsWith("by-")) {
    const column = segments[1]!.slice(3);
    return { kind: "single", table, column, value: segments[2]! };
  }

  // /{table}/{pkValue}
  if (segments.length === 2) {
    return { kind: "single", table, column: "__pk__", value: segments[1]! };
  }

  return null;
};

const parsePathValue = (raw: string): string | number => {
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== "") {
    return num;
  }
  return raw;
};

export const createRestHandler = (
  executor: DatabaseExecutor,
  schema: DatabaseSchema,
  options: RestHandlerOptions = {},
) => {
  const { basePath = "" } = options;
  const spec = generateOpenAPISpec(schema, options.openapi);
  const tableNames = new Set(Object.keys(schema.tables));

  // Build lookup maps for single-resource routing
  const tablePkColumn = new Map<string, string>();
  const tableUniqueColumns = new Map<string, Set<string>>();

  for (const [name, table] of Object.entries(schema.tables)) {
    if (table.primaryKey.length === 1) {
      tablePkColumn.set(name, table.primaryKey[0]!);
    }
    if (table.uniqueColumns.length > 0) {
      tableUniqueColumns.set(name, new Set(table.uniqueColumns));
    }
  }

  const resolveSingleColumn = (route: SingleResourceRoute): string | null => {
    if (route.column === "__pk__") {
      return tablePkColumn.get(route.table) ?? null;
    }
    const unique = tableUniqueColumns.get(route.table);
    if (unique?.has(route.column)) {
      return route.column;
    }
    return null;
  };

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    let pathname = url.pathname;

    if (basePath) {
      if (!pathname.startsWith(basePath)) {
        return errorResponse("Not found", 404, "NOT_FOUND");
      }
      pathname = pathname.slice(basePath.length) || "/";
    }

    if (pathname === "/" && req.method === "GET") {
      return json(spec);
    }

    const route = parseRoute(pathname, tableNames);

    if (!route) {
      return errorResponse("Table not found", 404, "NOT_FOUND");
    }

    try {
      if (route.kind === "single") {
        const column = resolveSingleColumn(route);
        if (!column) {
          return errorResponse("Not found", 404, "NOT_FOUND");
        }

        switch (req.method) {
          case "GET":
            return await handleGetOne(executor, route.table, column, route.value, url);
          case "PATCH":
            return await handlePatchOne(executor, route.table, column, route.value, req);
          case "DELETE":
            return await handleDeleteOne(executor, route.table, column, route.value);
          default:
            return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
        }
      }

      switch (req.method) {
        case "GET":
          return await handleGet(executor, route.table, url);
        case "POST":
          return await handlePost(executor, route.table, req);
        case "PATCH":
          return await handlePatch(executor, route.table, url, req);
        case "DELETE":
          return await handleDelete(executor, route.table, url);
        default:
          return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(message, 500, "INTERNAL_ERROR");
    }
  };
};

// Collection handlers

const handleGet = async (
  executor: DatabaseExecutor,
  table: string,
  url: URL,
): Promise<Response> => {
  const query = parseQueryParams(url);
  const selectQuery = buildSelectQuery(table, query);
  const countQuery = buildCountQuery(table, query);

  const [dataResult, countResult] = await Promise.all([
    executor.execute(selectQuery.sql, selectQuery.args),
    executor.execute(countQuery.sql, countQuery.args),
  ]);

  const totalCount = Number(countResult.rows[0]?.count ?? 0);

  return json(
    { data: dataResult.rows },
    200,
    {
      "X-Total-Count": String(totalCount),
      "Content-Range": `items ${query.offset ?? 0}-${(query.offset ?? 0) + dataResult.rows.length - 1}/${totalCount}`,
    },
  );
};

const handlePost = async (
  executor: DatabaseExecutor,
  table: string,
  req: Request,
): Promise<Response> => {
  const body = await req.json();

  if (body === null || typeof body !== "object") {
    return errorResponse("Request body must be a JSON object or array", 400, "BAD_REQUEST");
  }

  const rows = Array.isArray(body) ? body : [body];

  if (rows.length === 0) {
    return errorResponse("Request body must not be empty", 400, "BAD_REQUEST");
  }

  const results = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return errorResponse("Each row must be a JSON object", 400, "BAD_REQUEST");
    }
    const insertQuery = buildInsertQuery(table, row as Record<string, unknown>);
    const result = await executor.execute(insertQuery.sql, insertQuery.args);
    results.push(...result.rows);
  }

  return json({ data: results }, 201);
};

const handlePatch = async (
  executor: DatabaseExecutor,
  table: string,
  url: URL,
  req: Request,
): Promise<Response> => {
  const query = parseQueryParams(url);
  const body = await req.json();

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Request body must be a JSON object", 400, "BAD_REQUEST");
  }

  if (Object.keys(body as Record<string, unknown>).length === 0) {
    return errorResponse("Request body must not be empty", 400, "BAD_REQUEST");
  }

  if (query.filters.length === 0) {
    return errorResponse("Filters are required for update operations", 400, "BAD_REQUEST");
  }

  const updateQuery = buildUpdateQuery(
    table,
    body as Record<string, unknown>,
    query.filters,
  );
  const result = await executor.execute(updateQuery.sql, updateQuery.args);

  return json({ data: result.rows });
};

const handleDelete = async (
  executor: DatabaseExecutor,
  table: string,
  url: URL,
): Promise<Response> => {
  const query = parseQueryParams(url);

  if (query.filters.length === 0) {
    return errorResponse("Filters are required for delete operations", 400, "BAD_REQUEST");
  }

  const deleteQuery = buildDeleteQuery(table, query.filters);
  const result = await executor.execute(deleteQuery.sql, deleteQuery.args);

  return json({ data: result.rows });
};

// Single-resource handlers

const handleGetOne = async (
  executor: DatabaseExecutor,
  table: string,
  pkColumn: string,
  pkValue: string,
  url: URL,
): Promise<Response> => {
  const query = parseQueryParams(url);
  const selectQuery = buildSelectQuery(table, {
    select: query.select,
    filters: [{ column: pkColumn, operator: "eq", value: parsePathValue(pkValue) }],
    order: [],
    limit: 1,
  });

  const result = await executor.execute(selectQuery.sql, selectQuery.args);

  if (result.rows.length === 0) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: result.rows[0] });
};

const handlePatchOne = async (
  executor: DatabaseExecutor,
  table: string,
  pkColumn: string,
  pkValue: string,
  req: Request,
): Promise<Response> => {
  const body = await req.json();

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Request body must be a JSON object", 400, "BAD_REQUEST");
  }

  if (Object.keys(body as Record<string, unknown>).length === 0) {
    return errorResponse("Request body must not be empty", 400, "BAD_REQUEST");
  }

  const updateQuery = buildUpdateQuery(
    table,
    body as Record<string, unknown>,
    [{ column: pkColumn, operator: "eq", value: parsePathValue(pkValue) }],
  );
  const result = await executor.execute(updateQuery.sql, updateQuery.args);

  if (result.rows.length === 0) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: result.rows[0] });
};

const handleDeleteOne = async (
  executor: DatabaseExecutor,
  table: string,
  pkColumn: string,
  pkValue: string,
): Promise<Response> => {
  const deleteQuery = buildDeleteQuery(table, [
    { column: pkColumn, operator: "eq", value: parsePathValue(pkValue) },
  ]);
  const result = await executor.execute(deleteQuery.sql, deleteQuery.args);

  if (result.rows.length === 0) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: result.rows[0] });
};
