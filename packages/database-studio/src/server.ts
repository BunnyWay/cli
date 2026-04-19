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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const addCors = (res: Response): Response => {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.headers.set(key, value);
  }
  return res;
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

        // API routes - delegate to REST handler
        if (pathname.startsWith("/api")) {
          try {
            return addCors(await handleRest(req));
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return addCors(
              new Response(JSON.stringify({ message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
              }),
            );
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
