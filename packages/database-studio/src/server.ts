import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { createExecutor, introspect } from "@bunny.net/database-adapter";
import type { Database } from "@bunny.net/database-client";
import {
  createRestHandler,
  encodeValue,
  requireAuth,
} from "@bunny.net/database-rest";
import { loadCatalog } from "./catalog.ts";
import { assets } from "./client-manifest.ts";
import { queryErrorMessage, runReadOnlyQuery } from "./query.ts";

export interface StudioOptions {
  client: Database;
  /** Shown in the studio header so it's clear which database is open. */
  label?: string;
  /** True when the CLI created the token as read-only; otherwise only studio's own statement checks apply. */
  tokenReadOnly?: boolean;
  port?: number;
  /** Opens the studio URL in a browser; omit to only print it. */
  open?: (url: string) => void;
  dev?: boolean;
  logger?: {
    log(msg: string): void;
    error(msg: string): void;
  };
}

// Any other Host header could be a DNS-rebinding attack resolving to 127.0.0.1.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isAllowedHost = (host: string | null) =>
  host !== null && LOOPBACK_HOSTS.has(host.replace(/:\d+$/, ""));

const AUTH_COOKIE = "bunny_studio_auth";

const jsonResponse = (
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response =>
  new Response(JSON.stringify(body, encodeValue), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const errorText = (err: unknown) =>
  err instanceof Error ? (err.stack ?? err.message) : String(err);

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

const handleAuth = async (
  req: Request,
  sessionToken: string,
): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const body = (await req.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  if (typeof body?.token !== "string" || !safeEqual(body.token, sessionToken)) {
    return jsonResponse({ message: "Unauthorized" }, 401);
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": `${AUTH_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
    },
  });
};

export async function startStudio(options: StudioOptions): Promise<void> {
  const {
    client,
    label,
    tokenReadOnly = false,
    port = 4488,
    open,
    dev = false,
    logger = console,
  } = options;

  const clientDir = join(import.meta.dir, "..", "client");
  const distDir = join(import.meta.dir, "..", "dist", "client");

  const schema = await introspect({ client });
  // Sent once in the opened URL; the client trades it at /api/auth for an HttpOnly cookie.
  const sessionToken = randomBytes(32).toString("hex");
  const guard = (handler: (req: Request) => Promise<Response>) =>
    requireAuth(handler, { token: sessionToken, cookieName: AUTH_COOKIE });

  const handleRest = guard(
    createRestHandler(createExecutor({ client }), schema, {
      basePath: "/api",
      onError: (err) => logger.error(`API error: ${errorText(err)}`),
    }),
  );
  const tables = Object.values(schema.tables).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const { ddl, views } = await loadCatalog(
    client,
    new Set(tables.map((t) => t.name)),
  );
  const handleSchema = guard(async () =>
    jsonResponse({ label: label ?? null, tokenReadOnly, tables, ddl, views }),
  );
  const handleQuery = guard(async (req) => {
    if (req.method !== "POST") {
      return jsonResponse({ message: "Method not allowed" }, 405, {
        Allow: "POST",
      });
    }
    const body = (await req.json().catch(() => null)) as {
      sql?: unknown;
    } | null;
    if (typeof body?.sql !== "string") {
      return jsonResponse({ message: "Expected { sql: string }" }, 400);
    }
    try {
      return jsonResponse(await runReadOnlyQuery(client, body.sql));
    } catch (err) {
      const message = queryErrorMessage(err);
      if (message) return jsonResponse({ message }, 400);
      logger.error(`Query error: ${errorText(err)}`);
      return jsonResponse({ message: "Internal error" }, 500);
    }
  });

  const serveFile = async (path: string) => {
    const asset = assets[path];
    if (asset) return new Response(Bun.file(asset));
    const file = Bun.file(join(distDir, path));
    return (await file.exists()) ? new Response(file) : null;
  };

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      async fetch(req) {
        if (!isAllowedHost(req.headers.get("host"))) {
          return new Response("Forbidden", { status: 403 });
        }

        const { pathname } = new URL(req.url);

        if (pathname === "/studio-api/schema") return handleSchema(req);
        if (pathname === "/studio-api/query") return handleQuery(req);
        if (pathname === "/api/auth") return handleAuth(req, sessionToken);
        if (pathname.startsWith("/api")) {
          // The REST handler also serves writes, so refuse them regardless of the token's scope.
          if (req.method !== "GET") {
            return jsonResponse({ message: "Studio is read-only" }, 405, {
              Allow: "GET",
            });
          }
          return handleRest(req);
        }

        if (!dev) {
          const file =
            (await serveFile(pathname === "/" ? "/index.html" : pathname)) ??
            (await serveFile("/index.html"));
          if (file) return file;
        }

        return new Response("Not Found", { status: 404 });
      },
    });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "EADDRINUSE") {
      throw new Error(
        `Port ${port} is already in use. Try a different port with --port <number>.`,
      );
    }
    throw err;
  }

  let viteProc: ReturnType<typeof Bun.spawn> | undefined;
  let browserUrl: string;

  if (dev) {
    viteProc = Bun.spawn(["bunx", "--bun", "vite"], {
      cwd: clientDir,
      stdout: "inherit",
      stderr: "inherit",
    });
    await new Promise((r) => setTimeout(r, 1000));
    browserUrl = `http://localhost:5173/?token=${sessionToken}`;
    logger.log(`Studio API running at http://localhost:${server.port}`);
    logger.log(`Studio dev server at ${browserUrl}`);
  } else {
    browserUrl = `http://localhost:${server.port}/?token=${sessionToken}`;
    logger.log(`Studio running at ${browserUrl}`);
    logger.log("Press Ctrl+C to stop.");
  }

  if (open) {
    // A missing opener (headless Linux) must not take the server down.
    try {
      open(browserUrl);
    } catch {
      logger.log("Couldn't open a browser. Open the URL above to continue.");
    }
  }

  await new Promise<void>((resolve) => {
    const stop = () => {
      viteProc?.kill();
      server.stop();
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
