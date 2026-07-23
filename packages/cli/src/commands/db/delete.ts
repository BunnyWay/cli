import { dbDelete } from "@bunny.net/actions";
import { defineActionCommand } from "../../core/define-action-command.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, removeManifest } from "../../core/manifest.ts";
import { confirm, confirmTyped } from "../../core/ui.ts";
import { readEnvValue, removeEnvValue } from "../../utils/env-file.ts";
import { fetchDatabase } from "./api.ts";
import {
  ARG_DATABASE_ID,
  DATABASE_MANIFEST,
  type DatabaseManifest,
  ENV_DATABASE_AUTH_TOKEN,
  ENV_DATABASE_URL,
} from "./constants.ts";
import { resolveDbId } from "./resolve-db.ts";

const COMMAND = `delete [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Delete a database.";

const ARG_FORCE = "force";
const ARG_FORCE_ALIAS = "f";

/**
 * Permanently delete a database.
 *
 * This is a destructive, irreversible operation. All data, tokens, and
 * configuration for the database will be permanently removed.
 *
 * Requires two confirmations unless `--force` is passed:
 * 1. A yes/no confirmation prompt
 * 2. Typing the database name to verify
 *
 * @example
 * ```bash
 * # Interactive — double confirmation
 * bunny db delete db_01KCHBG8C5KSFGG0VRNFQ7EK7X
 *
 * # Skip confirmation prompts
 * bunny db delete db_01KCHBG8C5KSFGG0VRNFQ7EK7X --force
 *
 * # JSON output for scripting
 * bunny db delete db_01KCHBG8C5KSFGG0VRNFQ7EK7X --force --output json
 * ```
 */
export const dbDeleteCommand = defineActionCommand({
  action: dbDelete,
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db delete db_01KCH…", "Interactive — double confirmation"],
    ["$0 db delete db_01KCH… --force", "Skip confirmation prompts"],
    [
      "$0 db delete db_01KCH… --force --output json",
      "JSON output for scripting",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe:
          "Database ID (db_<ulid>). Auto-detected from BUNNY_DATABASE_URL in .env if omitted.",
      })
      .option(ARG_FORCE, {
        alias: ARG_FORCE_ALIAS,
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompts",
      }),

  progress: "Deleting database...",

  prepare: async (args, ctx) => {
    const { id, source } = await resolveDbId(
      ctx.clients.db,
      args[ARG_DATABASE_ID],
    );

    // Fetch the database so the confirmation can show and verify its name.
    const db = await fetchDatabase(ctx.clients.db, id);

    if (source === "env") {
      logger.dim(`Database: ${db.name} (${id}, from .env)`);
    } else if (source === "manifest") {
      logger.dim(`Database: ${db.name} (${id}, from .bunny/database.json)`);
    }

    return {
      input: { database: id },
      confirm: async () =>
        (await confirm(
          `Delete database "${db.name}" (${id})? This cannot be undone.`,
          { force: args.force },
        )) && confirmTyped(db.name, { force: args.force }),
    };
  },

  // Clean up the manifest and .env entries that pointed at the deleted database.
  // Skipped for json output, which must stay silent and unprompted.
  after: async (result, { output }) => {
    if (output === "json") return;

    const manifest = loadManifest<DatabaseManifest>(DATABASE_MANIFEST);
    if (manifest.id === result.id) {
      removeManifest(DATABASE_MANIFEST);
      logger.dim(`Removed stale .bunny/database.json.`);
    }

    const envUrl = readEnvValue(ENV_DATABASE_URL);
    if (envUrl && result.url && envUrl.value === result.url) {
      const shouldClean = await confirm(
        `Remove ${ENV_DATABASE_URL} from ${envUrl.envPath}?`,
      );
      if (shouldClean) {
        removeEnvValue(ENV_DATABASE_URL, envUrl.envPath);
        const envToken = readEnvValue(ENV_DATABASE_AUTH_TOKEN);
        if (envToken && envToken.envPath === envUrl.envPath) {
          removeEnvValue(ENV_DATABASE_AUTH_TOKEN, envToken.envPath);
          logger.success(
            `Removed ${ENV_DATABASE_URL} and ${ENV_DATABASE_AUTH_TOKEN} from ${envUrl.envPath}`,
          );
        } else {
          logger.success(`Removed ${ENV_DATABASE_URL} from ${envUrl.envPath}`);
        }
      }
    }
  },

  json: (result) => ({ db_id: result.id, deleted: true }),

  render: (result) => {
    logger.success(`Database "${result.name}" (${result.id}) deleted.`);
  },
});
