import type { Client } from "@libsql/client";
import type { DatabaseSchema, GenerateOptions } from "@bunny.net/database-openapi";
import { generateOpenAPISpec } from "@bunny.net/database-openapi";
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

function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function errorResponse(message: string, status: number, code?: string) {
  return json({ message, ...(code ? { code } : {}) }, status);
}

interface ParsedRoute {
  table: string;
  pkValue?: string;
}

function parseRoute(pathname: string, tableNames: Set<string>): ParsedRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const table = segments[0]!;
  if (!tableNames.has(table)) return null;

  if (segments.length === 1) {
    return { table };
  }

  if (segments.length === 2) {
    return { table, pkValue: decodeURIComponent(segments[1]!) };
  }

  return null;
}

export function createRestHandler(
  client: Client,
  schema: DatabaseSchema,
  options: RestHandlerOptions = {},
) {
  const { basePath = "" } = options;
  const spec = generateOpenAPISpec(schema, options.openapi);
  const tableNames = new Set(Object.keys(schema.tables));

  // Build a map of table -> single PK column name (only for single-column PKs)
  const tablePkColumn = new Map<string, string>();
  for (const [name, table] of Object.entries(schema.tables)) {
    if (table.primaryKey.length === 1) {
      tablePkColumn.set(name, table.primaryKey[0]!);
    }
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // Strip base path - reject requests that don't match
    if (basePath) {
      if (!pathname.startsWith(basePath)) {
        return errorResponse("Not found", 404, "NOT_FOUND");
      }
      pathname = pathname.slice(basePath.length) || "/";
    }

    // GET / - serve OpenAPI spec
    if (pathname === "/" && req.method === "GET") {
      return json(spec);
    }

    const route = parseRoute(pathname, tableNames);

    if (!route) {
      return errorResponse("Table not found", 404, "NOT_FOUND");
    }

    try {
      // Single-resource routes: /{table}/{pkValue}
      if (route.pkValue !== undefined) {
        const pkColumn = tablePkColumn.get(route.table);
        if (!pkColumn) {
          return errorResponse("Table does not have a single-column primary key", 400, "BAD_REQUEST");
        }

        switch (req.method) {
          case "GET":
            return await handleGetOne(client, route.table, pkColumn, route.pkValue, url);
          case "PATCH":
            return await handlePatchOne(client, route.table, pkColumn, route.pkValue, req);
          case "DELETE":
            return await handleDeleteOne(client, route.table, pkColumn, route.pkValue);
          default:
            return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
        }
      }

      // Collection routes: /{table}
      switch (req.method) {
        case "GET":
          return await handleGet(client, route.table, url);
        case "POST":
          return await handlePost(client, route.table, req);
        case "PATCH":
          return await handlePatch(client, route.table, url, req);
        case "DELETE":
          return await handleDelete(client, route.table, url);
        default:
          return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(message, 500, "INTERNAL_ERROR");
    }
  };
}

async function handleGet(
  client: Client,
  table: string,
  url: URL,
): Promise<Response> {
  const query = parseQueryParams(url);
  const selectQuery = buildSelectQuery(table, query);
  const countQuery = buildCountQuery(table, query);

  const [dataResult, countResult] = await Promise.all([
    client.execute({ sql: selectQuery.sql, args: selectQuery.args }),
    client.execute({ sql: countQuery.sql, args: countQuery.args }),
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
}

async function handlePost(
  client: Client,
  table: string,
  req: Request,
): Promise<Response> {
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
    const result = await client.execute({
      sql: insertQuery.sql,
      args: insertQuery.args,
    });
    results.push(...result.rows);
  }

  return json({ data: results }, 201);
}

async function handlePatch(
  client: Client,
  table: string,
  url: URL,
  req: Request,
): Promise<Response> {
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
  const result = await client.execute({
    sql: updateQuery.sql,
    args: updateQuery.args,
  });

  return json({ data: result.rows });
}

async function handleDelete(
  client: Client,
  table: string,
  url: URL,
): Promise<Response> {
  const query = parseQueryParams(url);

  if (query.filters.length === 0) {
    return errorResponse("Filters are required for delete operations", 400, "BAD_REQUEST");
  }

  const deleteQuery = buildDeleteQuery(table, query.filters);
  const result = await client.execute({
    sql: deleteQuery.sql,
    args: deleteQuery.args,
  });

  return json({ data: result.rows });
}

// Single-resource handlers

async function handleGetOne(
  client: Client,
  table: string,
  pkColumn: string,
  pkValue: string,
  url: URL,
): Promise<Response> {
  const query = parseQueryParams(url);
  const selectQuery = buildSelectQuery(table, {
    select: query.select,
    filters: [{ column: pkColumn, operator: "eq", value: parsePathValue(pkValue) }],
    order: [],
    limit: 1,
  });

  const result = await client.execute({
    sql: selectQuery.sql,
    args: selectQuery.args,
  });

  if (result.rows.length === 0) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: result.rows[0] });
}

async function handlePatchOne(
  client: Client,
  table: string,
  pkColumn: string,
  pkValue: string,
  req: Request,
): Promise<Response> {
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
  const result = await client.execute({
    sql: updateQuery.sql,
    args: updateQuery.args,
  });

  if (result.rows.length === 0) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: result.rows[0] });
}

async function handleDeleteOne(
  client: Client,
  table: string,
  pkColumn: string,
  pkValue: string,
): Promise<Response> {
  const deleteQuery = buildDeleteQuery(table, [
    { column: pkColumn, operator: "eq", value: parsePathValue(pkValue) },
  ]);
  const result = await client.execute({
    sql: deleteQuery.sql,
    args: deleteQuery.args,
  });

  if (result.rows.length === 0) {
    return errorResponse("Row not found", 404, "NOT_FOUND");
  }

  return json({ data: result.rows[0] });
}

function parsePathValue(raw: string): string | number {
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== "") {
    return num;
  }
  return raw;
}
