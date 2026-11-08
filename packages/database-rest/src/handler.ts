import type {
  DatabaseSchema,
  GenerateOptions,
} from "@bunny.net/database-openapi";
import { generateOpenAPISpec } from "@bunny.net/database-openapi";
import type { DatabaseExecutor } from "./executor.ts";
import { type Filter, parseQueryParams, QueryParseError } from "./parser.ts";
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

type Row = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;

interface HookContext {
  request: Request;
  table: string;
}

/**
 * Runs around writes. `before*` hooks run after validation and before the
 * write; they may return replacement rows or values, or throw a
 * `HookRejection` to answer with its status. `after*` hooks run once the
 * write has happened and get the affected rows; anything they throw goes to
 * `onError` and does not change the response, since the write is done.
 */
export interface RestHooks {
  /** Runs before the scope check, so it can fill in columns such as an owner. */
  beforeInsert?: (
    context: HookContext & { rows: Row[] },
  ) => MaybePromise<Row[] | undefined | void>;
  afterInsert?: (context: HookContext & { rows: Row[] }) => MaybePromise<void>;
  beforeUpdate?: (
    context: HookContext & { values: Row; filters: Filter[] },
  ) => MaybePromise<Row | undefined | void>;
  afterUpdate?: (context: HookContext & { rows: Row[] }) => MaybePromise<void>;
  beforeDelete?: (
    context: HookContext & { filters: Filter[] },
  ) => MaybePromise<void>;
  afterDelete?: (context: HookContext & { rows: Row[] }) => MaybePromise<void>;
}

/** Thrown from a `before*` hook to refuse a write with a client error. */
export class HookRejection extends Error {
  override name = "HookRejection";

  constructor(
    message: string,
    readonly status = 400,
    readonly code = "REJECTED",
  ) {
    super(message);
  }
}

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
  /** Lifecycle hooks around inserts, updates, and deletes. See {@link RestHooks}. */
  hooks?: RestHooks;
}

/** Everything a route handler needs for one request. */
interface RequestContext {
  executor: DatabaseExecutor;
  table: string;
  req: Request;
  url: URL;
  scope: Filter[];
  hooks: RestHooks;
  reportError: (err: unknown) => void;
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

    // The detail goes to the host's logger, not the response: a mounted handler must not leak schema names or file paths.
    const reportError = (err: unknown) => {
      try {
        options.onError?.(err);
      } catch {
        // A reporting hook that throws must not replace the response with a rejection.
      }
    };

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

      const ctx: RequestContext = {
        executor,
        table: route.table,
        req,
        url,
        scope: scoped ? [scoped] : [],
        hooks: options.hooks ?? {},
        reportError,
      };

      if (route.kind === "single") {
        const column = resolveSingleColumn(route);
        if (!column) {
          return errorResponse("Not found", 404, "NOT_FOUND");
        }
        const match: Filter = {
          column,
          operator: "eq",
          value: parsePathValue(route.value),
        };

        switch (req.method) {
          case "GET":
            return await handleGetOne(ctx, match);
          case "PATCH":
            return await handlePatchOne(ctx, match);
          case "DELETE":
            return await handleDeleteOne(ctx, match);
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
          return await handleGet(ctx);
        case "POST":
          return await handlePost(ctx);
        case "PATCH":
          return await handlePatch(ctx);
        case "DELETE":
          return await handleDelete(ctx);
        default:
          return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
      }
    } catch (err: unknown) {
      if (err instanceof QueryParseError) {
        return errorResponse(err.message, 400, "BAD_REQUEST");
      }
      if (err instanceof HookRejection) {
        return errorResponse(err.message, err.status, err.code);
      }
      reportError(err);

      return errorResponse("Internal error", 500, "INTERNAL_ERROR");
    }
  };
};

/** Runs an after-hook. The write has already happened, so a failure is reported, not returned. */
const runAfterHook = async (
  ctx: RequestContext,
  hook:
    | ((context: HookContext & { rows: Row[] }) => MaybePromise<void>)
    | undefined,
  rows: Row[],
) => {
  if (!hook || rows.length === 0) {
    return;
  }
  try {
    await hook({ request: ctx.req, table: ctx.table, rows });
  } catch (err) {
    ctx.reportError(err);
  }
};

/** Reads a JSON object body, or returns the 400 response to send. */
const readObjectBody = async (req: Request): Promise<Row | Response> => {
  const body = await req.json();

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(
      "Request body must be a JSON object",
      400,
      "BAD_REQUEST",
    );
  }

  if (Object.keys(body as Row).length === 0) {
    return errorResponse("Request body must not be empty", 400, "BAD_REQUEST");
  }

  return body as Row;
};

// Collection handlers

const handleGet = async (ctx: RequestContext): Promise<Response> => {
  const parsed = parseQueryParams(ctx.url);
  const query = { ...parsed, filters: [...parsed.filters, ...ctx.scope] };
  const selectQuery = buildSelectQuery(ctx.table, query);
  const countQuery = buildCountQuery(ctx.table, query);

  const [dataResult, countResult] = await Promise.all([
    ctx.executor.execute(selectQuery.sql, selectQuery.args),
    ctx.executor.execute(countQuery.sql, countQuery.args),
  ]);

  const totalCount = Number(countResult.rows[0]?.count ?? 0);

  return json({ data: dataResult.rows }, 200, {
    "X-Total-Count": String(totalCount),
    "Content-Range": `items ${query.offset ?? 0}-${(query.offset ?? 0) + dataResult.rows.length - 1}/${totalCount}`,
  });
};

const handlePost = async (ctx: RequestContext): Promise<Response> => {
  const body = await ctx.req.json();

  if (body === null || typeof body !== "object") {
    return errorResponse(
      "Request body must be a JSON object or array",
      400,
      "BAD_REQUEST",
    );
  }

  const received = Array.isArray(body) ? body : [body];

  if (received.length === 0) {
    return errorResponse("Request body must not be empty", 400, "BAD_REQUEST");
  }

  for (const row of received) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return errorResponse(
        "Each row must be a JSON object",
        400,
        "BAD_REQUEST",
      );
    }
  }

  const rows =
    (await ctx.hooks.beforeInsert?.({
      request: ctx.req,
      table: ctx.table,
      rows: received as Row[],
    })) ?? (received as Row[]);

  // Check every row before inserting any, so a body with one row out of
  // scope writes nothing. The filters only see the row's own values, so a
  // check made now still holds when the insert runs.
  if (ctx.scope.length > 0) {
    const required = filterColumns(ctx.scope);
    for (const row of rows) {
      if ([...required].some((column) => !(column in row))) {
        return forbidden();
      }
      const check = buildFilterCheckQuery(row, ctx.scope);
      const result = await ctx.executor.execute(check.sql, check.args);
      if (result.rows.length === 0) {
        return forbidden();
      }
    }
  }

  const results: Row[] = [];
  for (const row of rows) {
    const insertQuery = buildInsertQuery(ctx.table, row);
    const result = await ctx.executor.execute(
      insertQuery.sql,
      insertQuery.args,
    );
    results.push(...result.rows);
  }

  await runAfterHook(ctx, ctx.hooks.afterInsert, results);

  return json({ data: results }, 201);
};

/** Shared by bulk and single-row updates: runs hooks around one UPDATE. */
const runUpdate = async (
  ctx: RequestContext,
  received: Row,
  filters: Filter[],
): Promise<Row[]> => {
  const values =
    (await ctx.hooks.beforeUpdate?.({
      request: ctx.req,
      table: ctx.table,
      values: received,
      filters,
    })) ?? received;

  const updateQuery = buildUpdateQuery(ctx.table, values, filters);
  const result = await ctx.executor.execute(updateQuery.sql, updateQuery.args);
  await runAfterHook(ctx, ctx.hooks.afterUpdate, result.rows);

  return result.rows;
};

/** Shared by bulk and single-row deletes: runs hooks around one DELETE. */
const runDelete = async (
  ctx: RequestContext,
  filters: Filter[],
): Promise<Row[]> => {
  await ctx.hooks.beforeDelete?.({
    request: ctx.req,
    table: ctx.table,
    filters,
  });

  const deleteQuery = buildDeleteQuery(ctx.table, filters);
  const result = await ctx.executor.execute(deleteQuery.sql, deleteQuery.args);
  await runAfterHook(ctx, ctx.hooks.afterDelete, result.rows);

  return result.rows;
};

const handlePatch = async (ctx: RequestContext): Promise<Response> => {
  const query = parseQueryParams(ctx.url);
  const body = await readObjectBody(ctx.req);
  if (body instanceof Response) {
    return body;
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
  const rows = await runUpdate(ctx, body, [...query.filters, ...ctx.scope]);

  return json({ data: rows });
};

const handleDelete = async (ctx: RequestContext): Promise<Response> => {
  const query = parseQueryParams(ctx.url);

  if (query.filters.length === 0) {
    return errorResponse(
      "Filters are required for delete operations",
      400,
      "BAD_REQUEST",
    );
  }

  const rows = await runDelete(ctx, [...query.filters, ...ctx.scope]);

  return json({ data: rows });
};

// Single-resource handlers

const handleGetOne = async (
  ctx: RequestContext,
  match: Filter,
): Promise<Response> => {
  const query = parseQueryParams(ctx.url);
  const selectQuery = buildSelectQuery(ctx.table, {
    select: query.select,
    filters: [match, ...ctx.scope],
    order: [],
    limit: 1,
  });

  const result = await ctx.executor.execute(selectQuery.sql, selectQuery.args);

  if (result.rows.length === 0) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: result.rows[0] });
};

const handlePatchOne = async (
  ctx: RequestContext,
  match: Filter,
): Promise<Response> => {
  const body = await readObjectBody(ctx.req);
  if (body instanceof Response) {
    return body;
  }

  const [row] = await runUpdate(ctx, body, [match, ...ctx.scope]);
  if (!row) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: row });
};

const handleDeleteOne = async (
  ctx: RequestContext,
  match: Filter,
): Promise<Response> => {
  const [row] = await runDelete(ctx, [match, ...ctx.scope]);
  if (!row) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: row });
};
