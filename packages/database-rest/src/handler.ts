import type {
  DatabaseSchema,
  GenerateOptions,
} from "@bunny.net/database-openapi";
import { generateOpenAPISpec } from "@bunny.net/database-openapi";
import type { DatabaseExecutor } from "./executor.ts";
import { type Filter, parseQueryParams } from "./parser.ts";
import {
  buildCountQuery,
  buildDeleteQuery,
  buildFilterCheckQuery,
  buildInsertQuery,
  buildSelectQuery,
  buildUpdateQuery,
  filterColumns,
} from "./sql.ts";

export type ScopeOperation = "select" | "insert" | "update" | "delete";

export interface ScopeContext {
  request: Request;
  table: string;
  operation: ScopeOperation;
}

/**
 * What a scope hook returns: a filter to AND into the operation, `null` or
 * `undefined` for no restriction, or `false` to refuse the request with 403.
 */
export type ScopeResult = Filter | null | undefined | false;

export interface RestHandlerOptions {
  /** Base path prefix to strip before routing (e.g. "/api"). Defaults to none. */
  basePath?: string;
  /** Options passed to generateOpenAPISpec for the root endpoint. */
  openapi?: GenerateOptions;
  /** Called with the real error behind a 500 so the host can log it; responses never carry the detail. */
  onError?: (err: unknown) => void;
  /**
   * Restricts each request to the rows it may touch, for example to rows the
   * signed-in user owns. Called once per request after routing.
   *
   * - `select`, `update`, `delete`: the filter is ANDed into the query, so
   *   rows outside it are never read, changed, or deleted, and single-row
   *   routes answer 404 for them.
   * - `insert`: every row in the body must match the filter, checked before
   *   anything is written, or the request fails with 403. Each column the
   *   filter references must be in the row.
   *
   * An update is checked against the row as it is, not as it will be, so a
   * scope does not stop an update from moving a row out of scope.
   */
  scope?: (context: ScopeContext) => ScopeResult | Promise<ScopeResult>;
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

const parseRoute = (
  pathname: string,
  tableNames: Set<string>,
): ParsedRoute | null => {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [table, second, third] = segments;
  if (!table || !tableNames.has(table)) return null;

  // /{table}
  if (segments.length === 1) {
    return { kind: "collection", table };
  }

  // /{table}/by-{column}/{value}
  if (segments.length === 3 && second?.startsWith("by-") && third) {
    const column = second.slice(3);
    return { kind: "single", table, column, value: third };
  }

  // /{table}/{pkValue}
  if (segments.length === 2 && second) {
    return { kind: "single", table, column: "__pk__", value: second };
  }

  return null;
};

const SCOPE_OPERATIONS: Record<string, ScopeOperation> = {
  GET: "select",
  POST: "insert",
  PATCH: "update",
  DELETE: "delete",
};

const forbidden = () =>
  errorResponse("Not allowed by the request scope", 403, "FORBIDDEN");

const parsePathValue = (raw: string): string | number => {
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== "") {
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
    const [pkCol] = table.primaryKey;
    if (table.primaryKey.length === 1 && pkCol) {
      tablePkColumn.set(name, pkCol);
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
      const operation = SCOPE_OPERATIONS[req.method];
      const scoped =
        operation && options.scope
          ? await options.scope({
              request: req,
              table: route.table,
              operation,
            })
          : null;
      if (scoped === false) {
        return forbidden();
      }
      const scope: Filter[] = scoped ? [scoped] : [];

      if (route.kind === "single") {
        const column = resolveSingleColumn(route);
        if (!column) {
          return errorResponse("Not found", 404, "NOT_FOUND");
        }

        switch (req.method) {
          case "GET":
            return await handleGetOne(
              executor,
              route.table,
              column,
              route.value,
              url,
              scope,
            );
          case "PATCH":
            return await handlePatchOne(
              executor,
              route.table,
              column,
              route.value,
              req,
              scope,
            );
          case "DELETE":
            return await handleDeleteOne(
              executor,
              route.table,
              column,
              route.value,
              scope,
            );
          default:
            return errorResponse(
              "Method not allowed",
              405,
              "METHOD_NOT_ALLOWED",
            );
        }
      }

      switch (req.method) {
        case "GET":
          return await handleGet(executor, route.table, url, scope);
        case "POST":
          return await handlePost(executor, route.table, req, scope);
        case "PATCH":
          return await handlePatch(executor, route.table, url, req, scope);
        case "DELETE":
          return await handleDelete(executor, route.table, url, scope);
        default:
          return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
      }
    } catch (err: unknown) {
      // The detail goes to the host's logger, not the response: a mounted handler must not leak schema names or file paths.
      try {
        options.onError?.(err);
      } catch {
        // A reporting hook that throws must not replace the 500 with a rejection.
      }
      return errorResponse("Internal error", 500, "INTERNAL_ERROR");
    }
  };
};

// Collection handlers

const handleGet = async (
  executor: DatabaseExecutor,
  table: string,
  url: URL,
  scope: Filter[],
): Promise<Response> => {
  const parsed = parseQueryParams(url);
  const query = { ...parsed, filters: [...parsed.filters, ...scope] };
  const selectQuery = buildSelectQuery(table, query);
  const countQuery = buildCountQuery(table, query);

  const [dataResult, countResult] = await Promise.all([
    executor.execute(selectQuery.sql, selectQuery.args),
    executor.execute(countQuery.sql, countQuery.args),
  ]);

  const totalCount = Number(countResult.rows[0]?.count ?? 0);

  return json({ data: dataResult.rows }, 200, {
    "X-Total-Count": String(totalCount),
    "Content-Range": `items ${query.offset ?? 0}-${(query.offset ?? 0) + dataResult.rows.length - 1}/${totalCount}`,
  });
};

const handlePost = async (
  executor: DatabaseExecutor,
  table: string,
  req: Request,
  scope: Filter[],
): Promise<Response> => {
  const body = await req.json();

  if (body === null || typeof body !== "object") {
    return errorResponse(
      "Request body must be a JSON object or array",
      400,
      "BAD_REQUEST",
    );
  }

  const rows = Array.isArray(body) ? body : [body];

  if (rows.length === 0) {
    return errorResponse("Request body must not be empty", 400, "BAD_REQUEST");
  }

  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return errorResponse(
        "Each row must be a JSON object",
        400,
        "BAD_REQUEST",
      );
    }
  }

  // Check every row before inserting any, so a body with one row out of
  // scope writes nothing. The filters only see the row's own values, so a
  // check made now still holds when the insert runs.
  if (scope.length > 0) {
    const required = filterColumns(scope);
    for (const row of rows as Record<string, unknown>[]) {
      if ([...required].some((column) => !(column in row))) {
        return forbidden();
      }
      const check = buildFilterCheckQuery(row, scope);
      const result = await executor.execute(check.sql, check.args);
      if (result.rows.length === 0) {
        return forbidden();
      }
    }
  }

  const results = [];
  for (const row of rows) {
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
  scope: Filter[],
): Promise<Response> => {
  const query = parseQueryParams(url);
  const body = await req.json();

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(
      "Request body must be a JSON object",
      400,
      "BAD_REQUEST",
    );
  }

  if (Object.keys(body as Record<string, unknown>).length === 0) {
    return errorResponse("Request body must not be empty", 400, "BAD_REQUEST");
  }

  if (query.filters.length === 0) {
    return errorResponse(
      "Filters are required for update operations",
      400,
      "BAD_REQUEST",
    );
  }

  // The scope is added after the check above: it narrows an update, but must
  // not count as the filter that guards against updating every row.
  const updateQuery = buildUpdateQuery(table, body as Record<string, unknown>, [
    ...query.filters,
    ...scope,
  ]);
  const result = await executor.execute(updateQuery.sql, updateQuery.args);

  return json({ data: result.rows });
};

const handleDelete = async (
  executor: DatabaseExecutor,
  table: string,
  url: URL,
  scope: Filter[],
): Promise<Response> => {
  const query = parseQueryParams(url);

  if (query.filters.length === 0) {
    return errorResponse(
      "Filters are required for delete operations",
      400,
      "BAD_REQUEST",
    );
  }

  const deleteQuery = buildDeleteQuery(table, [...query.filters, ...scope]);
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
  scope: Filter[],
): Promise<Response> => {
  const query = parseQueryParams(url);
  const selectQuery = buildSelectQuery(table, {
    select: query.select,
    filters: [
      { column: pkColumn, operator: "eq", value: parsePathValue(pkValue) },
      ...scope,
    ],
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
  scope: Filter[],
): Promise<Response> => {
  const body = await req.json();

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(
      "Request body must be a JSON object",
      400,
      "BAD_REQUEST",
    );
  }

  if (Object.keys(body as Record<string, unknown>).length === 0) {
    return errorResponse("Request body must not be empty", 400, "BAD_REQUEST");
  }

  const updateQuery = buildUpdateQuery(table, body as Record<string, unknown>, [
    { column: pkColumn, operator: "eq", value: parsePathValue(pkValue) },
    ...scope,
  ]);
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
  scope: Filter[],
): Promise<Response> => {
  const deleteQuery = buildDeleteQuery(table, [
    { column: pkColumn, operator: "eq", value: parsePathValue(pkValue) },
    ...scope,
  ]);
  const result = await executor.execute(deleteQuery.sql, deleteQuery.args);

  if (result.rows.length === 0) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: result.rows[0] });
};
