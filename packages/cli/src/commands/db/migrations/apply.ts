import { relative } from "node:path";
import { defineCommand } from "../../../core/define-command.ts";
import { errorMessage, UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, isInteractive, spinner } from "../../../core/ui.ts";
import { ARG_DATABASE_ID, TOKEN_TTL_MINUTES } from "../constants.ts";
import { resolveCredentials } from "../credentials.ts";
import { ARG_DIR, MIGRATIONS_TABLE } from "./constants.ts";
import { warnOnDrift } from "./drift.ts";
import {
  applyMigration,
  discoverMigrations,
  ensureMigrationsTable,
  migrationStatuses,
  pendingMigrations,
  readApplied,
  resolveMigrationsDir,
} from "./engine.ts";

const COMMAND = `apply [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Apply pending migrations to a database.";

const ARG_URL = "url";
const ARG_TOKEN = "token";
const ARG_DRY_RUN = "dry-run";
const ARG_FORCE = "force";
const ARG_FORCE_ALIAS = "f";

interface ApplyArgs {
  [ARG_DATABASE_ID]?: string;
  [ARG_DIR]?: string;
  [ARG_URL]?: string;
  [ARG_TOKEN]?: string;
  [ARG_DRY_RUN]?: boolean;
  [ARG_FORCE]?: boolean;
}

/**
 * Apply every pending migration, in filename order.
 *
 * Each file runs as one atomic batch together with its tracking row, so a
 * migration either lands and is recorded or neither happens. The run stops at
 * the first failure and leaves the remaining migrations pending.
 *
 * @example
 * ```bash
 * bunny db migrations apply
 * bunny db migrations apply --dry-run
 * bunny db migrations apply --dir drizzle --force
 * ```
 */
export const dbMigrationsApplyCommand = defineCommand<ApplyArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db migrations apply", "Apply all pending migrations"],
    ["$0 db migrations apply --dry-run", "Show what would run without writing"],
    ["$0 db migrations apply --dir drizzle", "Apply drizzle-kit output"],
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
      })
      .option(ARG_DRY_RUN, {
        type: "boolean",
        default: false,
        describe: "List the migrations that would run, without applying them",
      })
      .option(ARG_FORCE, {
        alias: ARG_FORCE_ALIAS,
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompts",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    [ARG_DIR]: dirArg,
    [ARG_URL]: urlArg,
    [ARG_TOKEN]: tokenArg,
    [ARG_DRY_RUN]: dryRun,
    [ARG_FORCE]: force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const json = output === "json";

    const { dir, detected } = resolveMigrationsDir(dirArg);
    const files = discoverMigrations(dir);
    const displayDir = relative(process.cwd(), dir) || ".";

    if (files.length === 0) {
      throw new UserError(
        `No migrations found in ${displayDir}.`,
        "Run `bunny db migrations create <name>` to add one.",
      );
    }

    if (detected && !json) logger.dim(`Using ${displayDir}`);

    const { url, token, tokenGenerated } = await resolveCredentials({
      url: urlArg,
      token: tokenArg,
      databaseId: databaseIdArg,
      profile,
      apiKey,
      verbose,
    });

    if (tokenGenerated && !json) {
      logger.dim(
        `Session active for ${TOKEN_TTL_MINUTES} minutes. Re-run after that to reconnect.`,
      );
    }

    const { createClient } = await import("@libsql/client/web");
    const client = createClient({ url, authToken: token });

    // Read without creating the table, so --dry-run and a declined confirm leave the database untouched.
    const applied = await readApplied(client);
    const statuses = migrationStatuses(files, applied);
    const pending = pendingMigrations(files, applied);

    /** `pending` is what was outstanding at the start; `done` is what actually ran. */
    const report = (done: string[]) =>
      logger.log(
        JSON.stringify(
          {
            dir: displayDir,
            table: MIGRATIONS_TABLE,
            pending: pending.map((f) => f.name),
            applied: done,
            dry_run: Boolean(dryRun),
          },
          null,
          2,
        ),
      );

    if (pending.length === 0) {
      if (json) {
        report([]);
        return;
      }
      logger.success("Already up to date.");
      warnOnDrift(statuses);
      return;
    }

    if (!json) {
      logger.log(
        `${pending.length} pending migration${pending.length === 1 ? "" : "s"}:`,
      );
      for (const file of pending) logger.log(`  ${file.name}`);
      logger.log("");
      warnOnDrift(statuses);
    }

    if (dryRun) {
      if (json) {
        report([]);
        return;
      }
      logger.dim("Dry run: nothing was applied.");
      return;
    }

    // Prompt only when a human is watching, so CI and agent runs aren't blocked.
    const confirmed = await confirm("Apply now?", {
      force: force || !isInteractive(output),
      initial: true,
    });
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    await ensureMigrationsTable(client);

    const done: string[] = [];

    for (const file of pending) {
      const spin = spinner(`Applying ${file.name}...`);
      if (!json) spin.start();

      try {
        const { statements } = await applyMigration(client, file);
        spin.stop();
        done.push(file.name);
        if (!json) {
          logger.success(
            `${file.name} (${statements} statement${statements === 1 ? "" : "s"})`,
          );
        }
      } catch (err: unknown) {
        spin.stop();
        // The failed file rolled back, so it is still pending along with everything unattempted.
        const remaining = pending.length - done.length;
        throw new UserError(
          `${file.name} failed: ${errorMessage(err)}`,
          `${done.length} applied, ${remaining} still pending. Fix ${file.name} and re-run.`,
        );
      }
    }

    if (json) {
      report(done);
      return;
    }

    logger.log("");
    logger.success(
      `Applied ${done.length} migration${done.length === 1 ? "" : "s"}.`,
    );
  },
});
