import { relative } from "node:path";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { ARG_DATABASE_ID } from "../constants.ts";
import { resolveCredentials } from "../credentials.ts";
import { ARG_DIR, MIGRATIONS_TABLE } from "./constants.ts";
import { warnOnDrift } from "./drift.ts";
import {
  discoverMigrations,
  migrationStatuses,
  readApplied,
  resolveMigrationsDir,
} from "./engine.ts";

const COMMAND = `list [${ARG_DATABASE_ID}]`;
const ALIASES = ["ls", "status"] as const;
const DESCRIPTION = "Show which migrations have been applied.";

const ARG_URL = "url";
const ARG_TOKEN = "token";

const STATE_LABELS = {
  applied: "Applied",
  pending: "Pending",
  modified: "Modified",
  missing: "Missing",
} as const;

interface ListArgs {
  [ARG_DATABASE_ID]?: string;
  [ARG_DIR]?: string;
  [ARG_URL]?: string;
  [ARG_TOKEN]?: string;
}

/**
 * Compare the migration files on disk against what the database has recorded.
 *
 * @example
 * ```bash
 * bunny db migrations list
 * bunny db migrations list --output json
 * ```
 */
export const dbMigrationsListCommand = defineCommand<ListArgs>({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    ["$0 db migrations list", "Show applied and pending migrations"],
    ["$0 db migrations list --output json", "JSON output for scripting"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe:
          "Database ID (db_<ulid>). Auto-detected from BUNNY_DATABASE_URL in .env if omitted.",
      })
      .option(ARG_DIR, {
        type: "string",
        describe: "Migrations directory (default: migrations)",
      })
      .option(ARG_URL, {
        type: "string",
        describe: "Database URL (skips API lookup)",
      })
      .option(ARG_TOKEN, {
        type: "string",
        describe: "Auth token (skips token generation)",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    [ARG_DIR]: dirArg,
    [ARG_URL]: urlArg,
    [ARG_TOKEN]: tokenArg,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const { dir, detected } = resolveMigrationsDir(dirArg);
    const files = discoverMigrations(dir);
    const displayDir = relative(process.cwd(), dir) || ".";

    if (detected && output !== "json") {
      logger.dim(`Using ${displayDir}`);
    }

    const { url, token } = await resolveCredentials({
      url: urlArg,
      token: tokenArg,
      databaseId: databaseIdArg,
      profile,
      apiKey,
      verbose,
    });

    const { createClient } = await import("@libsql/client/web");
    const client = createClient({ url, authToken: token });

    // Don't create the tracking table from a read-only command.
    const applied = await readApplied(client);

    const statuses = migrationStatuses(files, applied);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            dir: displayDir,
            table: MIGRATIONS_TABLE,
            migrations: statuses.map((s) => ({
              name: s.name,
              state: s.state,
              applied_at: s.appliedAt ?? null,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (statuses.length === 0) {
      logger.info(`No migrations found in ${displayDir}.`);
      logger.dim("Run `bunny db migrations create <name>` to add one.");
      return;
    }

    logger.log(
      formatTable(
        ["Migration", "State", "Applied"],
        statuses.map((s) => [
          s.name,
          STATE_LABELS[s.state],
          s.appliedAt ?? "-",
        ]),
        output,
      ),
    );

    const pending = statuses.filter((s) => s.state === "pending").length;
    logger.log("");
    logger.dim(
      pending === 0
        ? "Up to date."
        : `${pending} pending. Run \`bunny db migrations apply\` to apply ${pending === 1 ? "it" : "them"}.`,
    );

    warnOnDrift(statuses);
  },
});
