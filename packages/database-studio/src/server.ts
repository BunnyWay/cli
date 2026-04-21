import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import {
  createLibSQLExecutor,
  introspect,
} from "@bunny.net/database-adapter-libsql";
import { createRestHandler } from "@bunny.net/database-rest";
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

// Hostnames that are safe to accept on a loopback-bound server. Requests with
// any other Host header are rejected to defend against DNS-rebinding attacks
// where a browser resolves an attacker-controlled name to 127.0.0.1.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isAllowedHost = (hostHeader: string | null): boolean => {
  if (!hostHeader) return false;
  // Strip an optional :port suffix. IPv6 hosts in Host headers are bracketed
  // (e.g. "[::1]:4488") so the trailing :port is unambiguous.
  const hostOnly = hostHeader.replace(/:\d+$/, "");
  return LOOPBACK_HOSTS.has(hostOnly);
};

const AUTH_COOKIE = "bunny_studio_auth";

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

const extractCookie = (req: Request, name: string): string | null => {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
};

const unauthorized = (): Response =>
  new Response(JSON.stringify({ message: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

const handleAuth = async (
  req: Request,
  sessionToken: string,
): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ message: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const provided = (body as { token?: unknown })?.token;
  if (typeof provided !== "string" || !safeEqual(provided, sessionToken)) {
    return unauthorized();
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
    port = 4488,
    open = true,
    dev = false,
    logger = console,
  } = options;

  const clientDir = join(import.meta.dir, "..", "client");
  const distDir = join(import.meta.dir, "..", "dist", "client");

  const schema = await introspect({ client });
  const executor = createLibSQLExecutor({ client });
  const handleRest = createRestHandler(executor, schema, { basePath: "/api" });
  // Random per-startup token. The auto-opened browser URL carries it once as
  // ?token=…; the client posts it to /api/auth which then sets an HttpOnly
  // cookie that gates every subsequent /api/* request.
  const sessionToken = randomBytes(32).toString("hex");

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      async fetch(req) {
        // Reject requests whose Host header isn't a loopback hostname.
        // Protects against DNS-rebinding even if the server is reachable via
        // a non-loopback address (e.g. when the caller overrides hostname).
        if (!isAllowedHost(req.headers.get("host"))) {
          return new Response("Forbidden", { status: 403 });
        }

        const url = new URL(req.url);
        const pathname = url.pathname;

        // API routes - delegate to REST handler
        if (pathname.startsWith("/api")) {
          // /api/auth is the handshake endpoint — public but only succeeds
          // with the correct session token.
          if (pathname === "/api/auth") {
            return await handleAuth(req, sessionToken);
          }
          const cookie = extractCookie(req, AUTH_COOKIE);
          if (!cookie || !safeEqual(cookie, sessionToken)) {
            return unauthorized();
          }
          try {
            return await handleRest(req);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return new Response(JSON.stringify({ message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
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

          // SPA fallback - serve index.html
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
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "EADDRINUSE") {
      throw new Error(
        `Port ${port} is already in use. Try a different port with --port <number>.`,
      );
    }
    throw err;
  }

  // In dev mode, spawn Vite dev server - it proxies /api back to this server
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
    browserUrl = `http://localhost:5173/?token=${sessionToken}`;
    logger.log(`Studio API running at http://localhost:${server.port}`);
    logger.log(`Studio dev server at ${browserUrl}`);
  } else {
    browserUrl = `http://localhost:${server.port}/?token=${sessionToken}`;
    logger.log(`Studio running at ${browserUrl}`);
    logger.log("Press Ctrl+C to stop.");
  }

  if (open) {
    const proc = Bun.spawn(
      process.platform === "darwin"
        ? ["open", browserUrl]
        : ["xdg-open", browserUrl],
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
