import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PrintMode, ShellLogger } from "@bunny.net/database-shell";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { resolveDbConnection } from "./connection.ts";
import { ARG_DATABASE_ID, TOKEN_TTL_MINUTES } from "./constants.ts";

const COMMAND = `shell [${ARG_DATABASE_ID}] [query]`;
const DESCRIPTION = "Open an interactive SQL shell for a database.";

const ARG_EXEC = "execute";
const ARG_EXEC_ALIAS = "e";
const ARG_MODE = "mode";
const ARG_MODE_ALIAS = "m";
const ARG_UNMASK = "unmask";
const ARG_URL = "url";
const ARG_TOKEN = "token";
const ARG_VIEWS_DIR = "views-dir";

const PRINT_MODES = ["default", "table", "json", "csv", "markdown"];

/** Create a ShellLogger adapter that wraps the CLI logger. */
function shellLogger(): ShellLogger {
  return {
    log: (msg?: string) => logger.log(msg ?? ""),
    error: (msg: string) => logger.error(msg),
    warn: (msg: string) => logger.warn(msg),
    dim: (msg: string) => logger.dim(msg),
    success: (msg: string) => logger.success(msg),
  };
}

export const dbShellCommand = defineCommand<{
  [ARG_DATABASE_ID]?: string;
  query?: string;
  [ARG_EXEC]?: string;
  [ARG_MODE]?: string;
  [ARG_UNMASK]?: boolean;
  [ARG_URL]?: string;
  [ARG_TOKEN]?: string;
  [ARG_VIEWS_DIR]?: string;
}>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db shell", "Interactive REPL (auto-detect from .env)"],
    ['$0 db shell -e "SELECT 1"', "Execute a query and exit"],
    ["$0 db shell --mode json", "JSON output mode"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe:
          "Database ID (db_<ulid>). Auto-detected from BUNNY_DATABASE_URL in .env if omitted.",
      })
      .positional("query", {
        type: "string",
        describe: "SQL statement to execute (exits after)",
      })
      .option(ARG_EXEC, {
        alias: ARG_EXEC_ALIAS,
        type: "string",
        describe: "Execute a SQL statement and exit",
      })
      .option(ARG_MODE, {
        alias: ARG_MODE_ALIAS,
        type: "string",
        choices: PRINT_MODES,
        default: "default",
        describe: "Output mode (default, table, json, csv, markdown)",
      })
      .option(ARG_UNMASK, {
        type: "boolean",
        default: false,
        describe: "Show sensitive column values unmasked",
      })
      .option(ARG_URL, {
        type: "string",
        describe: "Database URL (skips API lookup)",
      })
      .option(ARG_TOKEN, {
        type: "string",
        describe: "Auth token (skips token generation)",
      })
      .option(ARG_VIEWS_DIR, {
        type: "string",
        describe:
          "Directory for saved views (default: ~/.config/bunny/views/<db-id>/)",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    query: queryArg,
    [ARG_EXEC]: execArg,
    [ARG_MODE]: modeArg,
    [ARG_UNMASK]: unmaskArg,
    [ARG_URL]: urlArg,
    [ARG_TOKEN]: tokenArg,
    [ARG_VIEWS_DIR]: viewsDirArg,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const { createShellClient, startShell, executeQuery, executeFile } =
      await import("@bunny.net/database-shell");

    // If database-id doesn't look like a database ID, treat it as the query
    let databaseId = databaseIdArg;
    let sql = execArg ?? queryArg;
    if (databaseId && !sql && !databaseId.startsWith("db_")) {
      sql = databaseId;
      databaseId = undefined;
    }

    const OUTPUT_TO_MODE: Partial<Record<string, PrintMode>> = {
      json: "json",
      csv: "csv",
      table: "table",
      markdown: "markdown",
    };
    const initialMode: PrintMode =
      (modeArg as PrintMode) ?? OUTPUT_TO_MODE[output] ?? "default";

    const {
      url,
      token,
      databaseId: resolvedDbId,
      sessionCreated,
    } = await resolveDbConnection({
      url: urlArg,
      token: tokenArg,
      databaseId,
      profile,
      apiKey,
      verbose,
    });

    if (sessionCreated && output !== "json" && modeArg !== "json") {
      logger.dim(
        `Shell session active for ${TOKEN_TTL_MINUTES} minutes. Re-run after that to reconnect.`,
      );
    }

    const client = createShellClient({ url, authToken: token });
    const log = shellLogger();

    // Non-interactive: execute and exit
    if (sql) {
      if (sql.endsWith(".sql") && existsSync(resolve(sql))) {
        await executeFile(client, sql, {
          mode: initialMode,
          masked: !unmaskArg,
          logger: log,
        });
      } else {
        try {
          await executeQuery(client, sql, {
            mode: initialMode,
            masked: !unmaskArg,
            logger: log,
          });
        } catch (err: unknown) {
          throw new UserError(err instanceof Error ? err.message : String(err));
        }
      }
      return;
    }

    // Interactive REPL
    try {
      await startShell({
        client,
        mode: initialMode,
        masked: !unmaskArg,
        logger: log,
        databaseId: resolvedDbId,
        viewsDir: viewsDirArg ? resolve(viewsDirArg) : undefined,
      });
    } catch (err: unknown) {
      throw new UserError(
        err instanceof Error ? err.message : String(err),
        `Use --${ARG_EXEC} to run a statement non-interactively.`,
      );
    }
  },
});
