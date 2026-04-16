import { join } from "node:path";
import type { Client } from "@libsql/client";
import { assets } from "./client-manifest.ts";

export interface StudioOptions {
  client: Client;
  port?: number;
  open?: boolean;
  dev?: boolean;
  logger?: {
    log(msg: string): void;
    error(msg: string): void;
  };
}

interface TableInfo {
  name: string;
  type: string;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Validate a table/column name to prevent SQL injection (only allow alphanumeric, underscores). */
function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

const VALID_OPERATORS = new Set([
  "=", "!=", ">", "<", ">=", "<=", "LIKE", "NOT LIKE", "IS NULL", "IS NOT NULL",
]);

interface Filter {
  column: string;
  operator: string;
  value: string;
}

function parseFilters(url: URL): Filter[] {
  const raw = url.searchParams.get("filters");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f: any) =>
        typeof f.column === "string" &&
        typeof f.operator === "string" &&
        isValidIdentifier(f.column) &&
        VALID_OPERATORS.has(f.operator),
    );
  } catch {
    return [];
  }
}

function buildWhereClause(filters: Filter[], mode: "and" | "or" = "and"): { sql: string; args: (string | null)[] } {
  if (filters.length === 0) return { sql: "", args: [] };
  const conditions: string[] = [];
  const args: (string | null)[] = [];
  for (const f of filters) {
    if (f.operator === "IS NULL") {
      conditions.push(`"${f.column}" IS NULL`);
    } else if (f.operator === "IS NOT NULL") {
      conditions.push(`"${f.column}" IS NOT NULL`);
    } else {
      conditions.push(`"${f.column}" ${f.operator} ?`);
      args.push(f.value);
    }
  }
  const conjunction = mode === "or" ? " OR " : " AND ";
  return { sql: ` WHERE ${conditions.join(conjunction)}`, args };
}

function createApiHandler(client: Client) {
  return async (req: Request, pathname: string): Promise<Response | null> => {
    // GET /api/tables
    if (pathname === "/api/tables") {
      const result = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%' AND name NOT LIKE 'libsql_%' ORDER BY name",
      );
      const tables = [];
      for (const row of result.rows) {
        const name = row.name as string;
        const countResult = await client.execute(`SELECT COUNT(*) as count FROM "${name}"`);
        tables.push({
          name,
          rowCount: Number(countResult.rows[0]?.count ?? 0),
        });
      }
      return json(tables);
    }

    // GET /api/tables/:name/schema
    const schemaMatch = pathname.match(/^\/api\/tables\/([^/]+)\/schema$/);
    if (schemaMatch) {
      const tableName = decodeURIComponent(schemaMatch[1]!);
      if (!isValidIdentifier(tableName)) return json({ error: "Invalid table name" }, 400);

      const result = await client.execute(`PRAGMA table_info("${tableName}")`);
      const columns = result.rows.map((row) => ({
        cid: row.cid,
        name: row.name,
        type: row.type,
        notnull: row.notnull,
        defaultValue: row.dflt_value,
        primaryKey: row.pk,
      }));

      const fkResult = await client.execute(`PRAGMA foreign_key_list("${tableName}")`);
      const foreignKeys = fkResult.rows.map((row) => ({
        from: row.from,
        table: row.table,
        to: row.to,
      }));

      const indexResult = await client.execute(`PRAGMA index_list("${tableName}")`);
      const indexes = indexResult.rows.map((row) => ({
        name: row.name,
        unique: row.unique,
      }));

      return json({ columns, foreignKeys, indexes });
    }

    // GET /api/tables/:name/rows?page=1&limit=50&sort=col&order=asc
    const rowsMatch = pathname.match(/^\/api\/tables\/([^/]+)\/rows$/);
    if (rowsMatch) {
      const tableName = decodeURIComponent(rowsMatch[1]!);
      if (!isValidIdentifier(tableName)) return json({ error: "Invalid table name" }, 400);

      const url = new URL(req.url);
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
      const offset = (page - 1) * limit;

      const filters = parseFilters(url);
      const filterMode = url.searchParams.get("filterMode") === "or" ? "or" as const : "and" as const;
      const where = buildWhereClause(filters, filterMode);

      const sortCol = url.searchParams.get("sort");
      const sortOrder = url.searchParams.get("order")?.toUpperCase() === "DESC" ? "DESC" : "ASC";
      const orderBy = sortCol && isValidIdentifier(sortCol) ? ` ORDER BY "${sortCol}" ${sortOrder}` : "";

      const [dataResult, countResult] = await Promise.all([
        client.execute({
          sql: `SELECT * FROM "${tableName}"${where.sql}${orderBy} LIMIT ${limit} OFFSET ${offset}`,
          args: where.args,
        }),
        client.execute({
          sql: `SELECT COUNT(*) as count FROM "${tableName}"${where.sql}`,
          args: where.args,
        }),
      ]);

      const totalRows = Number(countResult.rows[0]?.count ?? 0);
      const columns = dataResult.columns;
      const rows = dataResult.rows;

      return json({
        columns,
        rows,
        pagination: {
          page,
          limit,
          totalRows,
          totalPages: Math.ceil(totalRows / limit),
        },
      });
    }

    // GET /api/tables/:name/lookup?column=col&value=val
    const lookupMatch = pathname.match(/^\/api\/tables\/([^/]+)\/lookup$/);
    if (lookupMatch) {
      const tableName = decodeURIComponent(lookupMatch[1]!);
      if (!isValidIdentifier(tableName)) return json({ error: "Invalid table name" }, 400);

      const url = new URL(req.url);
      const column = url.searchParams.get("column");
      const value = url.searchParams.get("value");
      if (!column) return json({ error: "Missing column parameter" }, 400);

      // Validate column name
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
        return json({ error: "Invalid column name" }, 400);
      }

      const result = await client.execute({
        sql: `SELECT * FROM "${tableName}" WHERE "${column}" = ? LIMIT 1`,
        args: [value ?? null],
      });

      if (result.rows.length === 0) {
        return json({ error: "Row not found" }, 404);
      }

      // Also fetch schema for column types
      const schemaResult = await client.execute(`PRAGMA table_info("${tableName}")`);
      const columns = schemaResult.columns;
      const schemaColumns = schemaResult.rows.map((row) => ({
        name: row.name,
        type: row.type,
      }));

      const fkResult = await client.execute(`PRAGMA foreign_key_list("${tableName}")`);
      const foreignKeys = fkResult.rows.map((row) => ({
        from: row.from,
        table: row.table,
        to: row.to,
      }));

      return json({
        row: result.rows[0],
        columns: result.columns,
        schema: schemaColumns,
        foreignKeys,
      });
    }

    return null;
  };
}

export async function startStudio(options: StudioOptions): Promise<void> {
  const { client, port = 4488, open = true, dev = false, logger = console } = options;

  const clientDir = join(import.meta.dir, "..", "client");
  const distDir = join(import.meta.dir, "..", "dist", "client");
  const handleApi = createApiHandler(client);

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
      }

      // API routes
      if (pathname.startsWith("/api/")) {
        try {
          const response = await handleApi(req, pathname);
          if (response) return response;
        } catch (err: any) {
          return json({ error: err.message }, 500);
        }
      }

      if (!dev) {
        const lookup = pathname === "/" ? "/index.html" : pathname;

        // Try embedded manifest first (works in compiled binary)
        const assetPath = assets[lookup];
        if (assetPath) return new Response(Bun.file(assetPath));

        // Fall back to filesystem (works in source mode without manifest)
        try {
          const filePath = join(distDir, lookup);
          const file = Bun.file(filePath);
          if (await file.exists()) return new Response(file);
        } catch {
          // fall through
        }

        // SPA fallback — serve index.html
        const indexAsset = assets["/index.html"];
        if (indexAsset) return new Response(Bun.file(indexAsset));
        try {
          const indexFile = Bun.file(join(distDir, "index.html"));
          if (await indexFile.exists()) return new Response(indexFile);
        } catch {
          // fall through
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });
  } catch (err: any) {
    if (err?.code === "EADDRINUSE") {
      throw new Error(
        `Port ${port} is already in use. Try a different port with --port <number>.`,
      );
    }
    throw err;
  }

  // In dev mode, spawn Vite dev server — it proxies /api back to this server
  let viteProc: ReturnType<typeof Bun.spawn> | undefined;
  let browserUrl: string;

  if (dev) {
    viteProc = Bun.spawn(["bunx", "--bun", "vite"], {
      cwd: clientDir,
      stdout: "inherit",
      stderr: "inherit",
    });
    // Give Vite a moment to bind its port
    await new Promise((r) => setTimeout(r, 1000));
    browserUrl = "http://localhost:5173";
    logger.log(`Studio API running at http://localhost:${server.port}`);
    logger.log(`Studio dev server at ${browserUrl}`);
  } else {
    browserUrl = `http://localhost:${server.port}`;
    logger.log(`Studio running at ${browserUrl}`);
    logger.log("Press Ctrl+C to stop.");
  }

  if (open) {
    const proc = Bun.spawn(
      process.platform === "darwin" ? ["open", browserUrl] : ["xdg-open", browserUrl],
      { stdout: "ignore", stderr: "ignore" },
    );
    await proc.exited;
  }

  // Keep the process alive until interrupted
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      viteProc?.kill();
      server.stop();
      resolve();
    });
    process.on("SIGTERM", () => {
      viteProc?.kill();
      server.stop();
      resolve();
    });
  });
}
