import prompts from "prompts";
import { defineCommand } from "../../core/define-command.ts";
import { resolveConfig } from "../../config/index.ts";
import { createDbClient } from "@bunny.net/api";
import { resolveDbId } from "./resolve-db.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { logger } from "../../core/logger.ts";
import { UserError } from "../../core/errors.ts";
import { ARG_DATABASE_ID, ENV_DATABASE_URL, ENV_DATABASE_AUTH_TOKEN } from "./constants.ts";
import { clientOptions } from "../../core/client-options.ts";
import { readEnvValue, removeEnvValue } from "../../utils/env-file.ts";

const COMMAND = `delete [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Delete a database.";

const ARG_FORCE = "force";
const ARG_FORCE_ALIAS = "f";

interface DeleteArgs {
  [ARG_DATABASE_ID]?: string;
  [ARG_FORCE]?: boolean;
}

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
export const dbDeleteCommand = defineCommand<DeleteArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db delete db_01KCH…", "Interactive — double confirmation"],
    ["$0 db delete db_01KCH… --force", "Skip confirmation prompts"],
    ["$0 db delete db_01KCH… --force --output json", "JSON output for scripting"],
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

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createDbClient(clientOptions(config, verbose));

    const { id: databaseId, source } = await resolveDbId(client, databaseIdArg);

    // Fetch database details so we can show/confirm the name
    const fetchSpin = spinner("Fetching database...");
    fetchSpin.start();

    const { data } = await client.GET("/v2/databases/{db_id}", {
      params: { path: { db_id: databaseId } },
    });

    fetchSpin.stop();

    const db = data?.db;
    if (!db) throw new UserError(`Database ${databaseId} not found.`);

    if (source === "env") {
      logger.dim(`Database: ${db.name} (${databaseId}, from .env)`);
    }

    // First confirmation
    const confirmed = await confirm(
      `Delete database "${db.name}" (${databaseId})? This cannot be undone.`,
      { force },
    );

    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    // Second confirmation: type the database name
    if (!force) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: `Type "${db.name}" to confirm:`,
      });

      if (value !== db.name) {
        logger.log("Cancelled.");
        return;
      }
    }

    const deleteSpin = spinner("Deleting database...");
    deleteSpin.start();

    await client.DELETE("/v2/databases/{db_id}", {
      params: { path: { db_id: databaseId } },
    });

    deleteSpin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify({ db_id: databaseId, deleted: true }, null, 2),
      );
      return;
    }

    logger.success(`Database "${db.name}" (${databaseId}) deleted.`);

    // Offer to clean up .env if it references the deleted database
    const envUrl = readEnvValue(ENV_DATABASE_URL);
    if (envUrl && db.url && envUrl.value === db.url) {
      const shouldClean = await confirm(
        `Remove ${ENV_DATABASE_URL} from ${envUrl.envPath}?`,
        { force },
      );

      if (shouldClean) {
        removeEnvValue(ENV_DATABASE_URL, envUrl.envPath);
        const envToken = readEnvValue(ENV_DATABASE_AUTH_TOKEN);
        if (envToken && envToken.envPath === envUrl.envPath) {
          removeEnvValue(ENV_DATABASE_AUTH_TOKEN, envToken.envPath);
          logger.success(`Removed ${ENV_DATABASE_URL} and ${ENV_DATABASE_AUTH_TOKEN} from ${envUrl.envPath}`);
        } else {
          logger.success(`Removed ${ENV_DATABASE_URL} from ${envUrl.envPath}`);
        }
      }
    }
  },
});
