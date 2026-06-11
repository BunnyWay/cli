import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import {
  loadProjectConfig,
  projectConfigPath,
} from "../../core/project-config.ts";
import { openBrowser } from "../../core/ui.ts";
import { buildProjectGraph } from "./dashboard-graph.ts";
import { DASHBOARD_HTML } from "./dashboard-page.ts";

const COMMAND = "dashboard";
const DESCRIPTION = "Open a live canvas of the project's resources.";

const ARG_PORT = "port";
const ARG_CONFIG = "config";
const ARG_OPEN = "open";

interface DashboardArgs {
  [ARG_PORT]?: number;
  [ARG_CONFIG]?: string;
  [ARG_OPEN]?: boolean;
}

/**
 * Serve a local web canvas of the bunny.jsonc resource map. The config is
 * re-read on every poll, so edits to the file (by hand or via `bunny project
 * add` / `db create`) appear on the canvas within a couple of seconds.
 */
export const projectDashboardCommand = defineCommand<DashboardArgs>({
  command: COMMAND,
  aliases: ["canvas"],
  describe: DESCRIPTION,
  examples: [
    ["$0 project dashboard", "Open the canvas for the nearest bunny.jsonc"],
    [
      "$0 project dashboard --port 3000 --no-open",
      "Serve without opening a browser",
    ],
  ],

  builder: (yargs) =>
    yargs
      .option(ARG_PORT, {
        type: "number",
        default: 4499,
        describe: "Port for the canvas server",
      })
      .option(ARG_CONFIG, {
        type: "string",
        describe: "Path to a project config file",
      })
      .option(ARG_OPEN, {
        type: "boolean",
        default: true,
        describe:
          "Open the browser automatically. Use --no-open to skip.",
      }),

  handler: async (args) => {
    // Pin the config path at startup so the server keeps watching one file.
    const path = projectConfigPath(args[ARG_CONFIG]);
    loadProjectConfig(args[ARG_CONFIG]);

    let server: ReturnType<typeof Bun.serve>;
    try {
      server = Bun.serve({
        port: args[ARG_PORT] ?? 4499,
        fetch(req) {
          const { pathname } = new URL(req.url);

          if (pathname === "/api/project") {
            try {
              const config = loadProjectConfig(path);
              return Response.json({
                path,
                version: config.version,
                graph: buildProjectGraph(config),
              });
            } catch (err) {
              return Response.json({
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (pathname === "/") {
            return new Response(DASHBOARD_HTML, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          return new Response("Not found", { status: 404 });
        },
      });
    } catch (err) {
      throw new UserError(
        `Could not start the canvas server: ${err instanceof Error ? err.message : err}`,
        "Pass --port to use a different port.",
      );
    }

    const url = `http://localhost:${server.port}`;
    logger.success(`Project canvas running at ${url}`);
    logger.dim(`  Watching ${path} — edits appear live. Ctrl+C to stop.`);

    if (args[ARG_OPEN] !== false) openBrowser(url);
  },
});
