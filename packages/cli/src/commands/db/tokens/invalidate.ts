import { createDbClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatKeyValue } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import {
  readEnvValue,
  removeEnvValue,
  writeEnvValue,
} from "../../../utils/env-file.ts";
import {
  ARG_DATABASE_ID,
  ENV_DATABASE_AUTH_TOKEN,
  ENV_DATABASE_URL,
} from "../constants.ts";
import { resolveDbId } from "../resolve-db.ts";

const COMMAND = `invalidate [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Invalidate all auth tokens for a database.";

const ARG_FORCE = "force";
const ARG_FORCE_ALIAS = "f";
const ARG_REGENERATE = "regenerate";
const ARG_SAVE_ENV = "save-env";

/**
 * Invalidate all auth tokens for a database.
 *
 * This is a destructive, irreversible operation — every existing token for the
 * database is immediately revoked. Any application using a previously issued
 * token will lose access until a new token is generated.
 *
 * After invalidation the command offers two follow-up actions (skipped with
 * `--force`):
 *
 * 1. **Remove stale token** — If `BUNNY_DATABASE_AUTH_TOKEN` exists in a local
 *    `.env` file, the user is prompted to delete it so nothing references the
 *    now-invalid token.
 * 2. **Generate a replacement** — A new full-access, non-expiring token can be
 *    created on the spot and optionally saved back to `.env` (along with
 *    `BUNNY_DATABASE_URL` if it is missing).
 *
 * @example
 * ```bash
 * # Interactive — prompts for confirmation
 * bunny db tokens invalidate db_01KCHBG8C5KSFGG0VRNFQ7EK7X
 *
 * # Auto-detect database from .env, skip all prompts
 * bunny db tokens invalidate --force
 *
 * # Invalidate, regenerate, and save to .env non-interactively
 * bunny db tokens invalidate --force --regenerate --save-env
 *
 * # JSON output (for scripting)
 * bunny db tokens invalidate db_01KCHBG8C5KSFGG0VRNFQ7EK7X --force --output json
 * ```
 */
export const dbTokensInvalidateCommand = defineCommand<{
  [ARG_DATABASE_ID]?: string;
  [ARG_FORCE]?: boolean;
  [ARG_REGENERATE]?: boolean;
  [ARG_SAVE_ENV]?: boolean;
}>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db tokens invalidate", "Interactive — prompts for confirmation"],
    ["$0 db tokens invalidate --force", "Skip all prompts"],
    [
      "$0 db tokens invalidate --force --regenerate --save-env",
      "Non-interactive with replacement",
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
      })
      .option(ARG_REGENERATE, {
        type: "boolean",
        default: false,
        describe: "Generate a replacement token after invalidation",
      })
      .option(ARG_SAVE_ENV, {
        type: "boolean",
        describe: "Save the new token to .env (requires --regenerate)",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    force,
    regenerate,
    "save-env": saveEnv,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createDbClient(clientOptions(config, verbose));

    // Resolve the target database — explicit ID, .env, or interactive prompt
    const {
      id: databaseId,
      name: databaseName,
      source,
    } = await resolveDbId(client, databaseIdArg);

    const dbLabel = databaseName
      ? `${databaseName} (${databaseId})`
      : databaseId;
    if (source === "env") {
      logger.dim(`Database: ${dbLabel} (from .env)`);
    } else if (source === "manifest") {
      logger.dim(`Database: ${dbLabel} (from .bunny/database.json)`);
    }

    // Confirm before the destructive operation
    const confirmed = await confirm(
      `Invalidate all tokens for ${databaseId}? This cannot be undone.`,
      { force },
    );

    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    // Invalidate all tokens via the API
    const spin2 = spinner("Invalidating tokens...");
    spin2.start();

    await client.POST("/v2/databases/{db_id}/auth/revoke", {
      params: { path: { db_id: databaseId } },
    });

    spin2.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify({ db_id: databaseId, invalidated: true }, null, 2),
      );
      return;
    }

    logger.success(`All tokens invalidated for ${databaseId}.`);

    // Offer to remove the now-stale BUNNY_DATABASE_AUTH_TOKEN from .env
    const existingToken = readEnvValue(ENV_DATABASE_AUTH_TOKEN);
    if (existingToken) {
      const shouldRemove = await confirm(
        `Remove ${ENV_DATABASE_AUTH_TOKEN} from ${existingToken.envPath}?`,
        { force },
      );
      if (shouldRemove) {
        removeEnvValue(ENV_DATABASE_AUTH_TOKEN, existingToken.envPath);
        logger.success(`Removed ${ENV_DATABASE_AUTH_TOKEN} from .env`);
      }
    }

    // Offer to generate a replacement token
    // With --force: only generate if --regenerate is explicitly set
    // Without --force: prompt the user
    const shouldCreate = force
      ? !!regenerate
      : await confirm("Generate a new token?");
    if (!shouldCreate) {
      logger.warn("All tokens have been invalidated. No valid tokens remain.");
      logger.dim(
        `  Run 'bunny db tokens create ${databaseId}' to generate a new one.`,
      );
      return;
    }

    const spin3 = spinner("Generating token...");
    spin3.start();

    const [tokenResult, dbResult] = await Promise.all([
      client.PUT("/v2/databases/{db_id}/auth/generate", {
        params: { path: { db_id: databaseId } },
        body: { authorization: "full-access", expires_at: null },
      }),
      client.GET("/v2/databases/{db_id}", {
        params: { path: { db_id: databaseId } },
      }),
    ]);

    spin3.stop();

    const newToken = tokenResult.data?.token;
    const dbUrl = dbResult.data?.db?.url;

    if (!newToken) {
      logger.error("Failed to generate token.");
      return;
    }

    logger.success("Token generated.");
    logger.log();
    logger.log(
      formatKeyValue(
        [
          { key: "Token", value: newToken },
          { key: "Access", value: "full-access" },
          { key: "Expires", value: "never" },
        ],
        "text",
      ),
    );
    logger.log();

    // Offer to persist the new token (and URL if missing) to .env
    // --save-env bypasses the prompt; --save-env=false skips saving
    const shouldSave =
      saveEnv !== undefined
        ? saveEnv
        : await confirm(`Save ${ENV_DATABASE_AUTH_TOKEN} to .env?`);
    if (shouldSave) {
      const envPath = existingToken?.envPath;
      writeEnvValue(ENV_DATABASE_AUTH_TOKEN, newToken, envPath);

      if (dbUrl && !readEnvValue(ENV_DATABASE_URL)) {
        writeEnvValue(ENV_DATABASE_URL, dbUrl, envPath);
        logger.success(
          `Saved ${ENV_DATABASE_URL} and ${ENV_DATABASE_AUTH_TOKEN} to .env`,
        );
      } else {
        logger.success(`Saved ${ENV_DATABASE_AUTH_TOKEN} to .env`);
      }
    }
  },
});
