import { relative } from "node:path";
import { defineCommand } from "../../../core/define-command.ts";
import { errorMessage, UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, isInteractive, spinner } from "../../../core/ui.ts";
import { ARG_DATABASE_ID, TOKEN_TTL_MINUTES } from "../constants.ts";
import { databaseTarget, resolveCredentials } from "../credentials.ts";
import {
  ARG_DIR,
  ARG_PATTERN,
  DEFAULT_MIGRATIONS_PATTERN,
  MIGRATIONS_TABLE,
} from "./constants.ts";
import {
  assertMigrationHistorySafe,
  migrationHistoryIssues,
  warnOnDrift,
} from "./drift.ts";
import {
  applyMigration,
  discoverMigrations,
  ensureMigrationsTable,
  migrationStatements,
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
const ARG_ALLOW_DRIFT = "allow-drift";

interface ApplyArgs {
  [ARG_DATABASE_ID]?: string;
  [ARG_DIR]?: string;
  [ARG_PATTERN]?: string;
  [ARG_URL]?: string;
  [ARG_TOKEN]?: string;
  [ARG_DRY_RUN]?: boolean;
  [ARG_FORCE]?: boolean;
  [ARG_ALLOW_DRIFT]?: boolean;
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
      .option(ARG_PATTERN, {
        type: "string",
        default: DEFAULT_MIGRATIONS_PATTERN,
        describe: "Migration glob relative to --dir",
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
      })
      .option(ARG_ALLOW_DRIFT, {
        type: "boolean",
        default: false,
        describe: "Apply despite modified, missing, or out-of-order history",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    [ARG_DIR]: dirArg,
    [ARG_PATTERN]: pattern = DEFAULT_MIGRATIONS_PATTERN,
    [ARG_URL]: urlArg,
    [ARG_TOKEN]: tokenArg,
    [ARG_DRY_RUN]: dryRun,
    [ARG_FORCE]: force,
    [ARG_ALLOW_DRIFT]: allowDrift,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const json = output === "json";

    const { dir, detected } = resolveMigrationsDir(dirArg);
    const files = discoverMigrations(dir, pattern);
    const displayDir = relative(process.cwd(), dir) || ".";

    if (files.length === 0) {
      const nested =
        pattern === DEFAULT_MIGRATIONS_PATTERN
          ? discoverMigrations(dir, "**/*.sql")
          : [];
      throw new UserError(
        `No migrations matched ${pattern} in ${displayDir}.`,
        nested.length > 0
          ? 'Nested SQL files were found. Pass a matching glob such as `--pattern "*/migration.sql"`.'
          : "Run `bunny db migrations create <name>` to add one.",
      );
    }

    if (detected && !json) logger.dim(`Using ${displayDir}`);

    const { url, token, tokenGenerated, databaseId } = await resolveCredentials(
      {
        url: urlArg,
        token: tokenArg,
        databaseId: databaseIdArg,
        profile,
        apiKey,
        verbose,
      },
    );

    if (tokenGenerated && !json) {
      logger.dim(
        `Session active for ${TOKEN_TTL_MINUTES} minutes. Re-run after that to reconnect.`,
      );
    }

    const { connectForMigrations } = await import("./client.ts");
    const client = connectForMigrations({ url, authToken: token });
    const target = databaseTarget(url, databaseId);

    if (!json) logger.dim(`Database: ${target.label}`);

    // Read without creating the table, so --dry-run and a declined confirm leave the database untouched.
    const applied = await readApplied(client);
    const statuses = migrationStatuses(files, applied);
    const pending = pendingMigrations(files, applied);
    const issues = migrationHistoryIssues(statuses);

    /** `pending` is what was outstanding at the start; `done` is what actually ran. */
    const report = (done: string[]) =>
      logger.log(
        JSON.stringify(
          {
            dir: displayDir,
            pattern,
            table: MIGRATIONS_TABLE,
            target: {
              database_id: target.databaseId,
              host: target.host,
            },
            planned: pending.map((f) => f.name),
            applied: done,
            remaining: pending
              .filter((file) => !done.includes(file.name))
              .map((file) => file.name),
            issues: issues.map(({ name, state }) => ({ name, state })),
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
      logger.success(
        issues.length === 0 ? "Already up to date." : "No pending migrations.",
      );
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

    assertMigrationHistorySafe(statuses, Boolean(allowDrift));

    // Parse every pending file before the first database write, so a malformed
    // later file cannot leave the run predictably half-complete.
    const prepared = new Map(
      pending.map((file) => [file.name, migrationStatements(file)]),
    );

    if (dryRun) {
      if (json) {
        report([]);
        return;
      }
      logger.dim("Dry run: nothing was applied.");
      return;
    }

    // Prompt only when a human is watching, so CI and agent runs aren't blocked.
    const confirmed = await confirm(`Apply to ${target.label}?`, {
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
        const { statements } = await applyMigration(client, file, {
          statements: prepared.get(file.name),
        });
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
