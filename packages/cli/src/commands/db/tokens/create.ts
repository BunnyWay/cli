import { defineCommand } from "../../../core/define-command.ts";
import { resolveConfig } from "../../../config/index.ts";
import { createDbClient } from "@bunny.net/api";
import { resolveDbId } from "../resolve-db.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { logger } from "../../../core/logger.ts";
import { UserError } from "../../../core/errors.ts";
import { readEnvValue, writeEnvValue } from "../../../utils/env-file.ts";
import { formatKeyValue } from "../../../core/format.ts";
import { ARG_DATABASE_ID, ENV_DATABASE_URL, ENV_DATABASE_AUTH_TOKEN } from "../constants.ts";
import { clientOptions } from "../../../core/client-options.ts";

const COMMAND = `create [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Generate an auth token for a database.";

const ARG_READ_ONLY = "read-only";
const ARG_EXPIRY = "expiry";
const ARG_EXPIRY_ALIAS = "e";
const ARG_SAVE = "save";
const ARG_FORCE = "force";
const ARG_FORCE_ALIAS = "f";

/**
 * Parse an expiry value into an RFC 3339 date string.
 * Accepts duration shorthands (e.g. "30d", "12h", "1y") or an RFC 3339 date.
 */
function parseExpiry(value: string): string {
  const match = value.match(/^(\d+)([hdwmy])$/i);
  if (match) {
    const amount = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();
    const date = new Date();

    switch (unit) {
      case "h":
        date.setHours(date.getHours() + amount);
        break;
      case "d":
        date.setDate(date.getDate() + amount);
        break;
      case "w":
        date.setDate(date.getDate() + amount * 7);
        break;
      case "m":
        date.setMonth(date.getMonth() + amount);
        break;
      case "y":
        date.setFullYear(date.getFullYear() + amount);
        break;
    }

    return date.toISOString();
  }

  // Try parsing as a date directly
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    throw new UserError(
      `Invalid expiry value: "${value}"`,
      "Use a duration (e.g. 30d, 12h, 1y) or an RFC 3339 date.",
    );
  }

  return parsed.toISOString();
}

/**
 * Generate an auth token for a database.
 *
 * Tokens can be scoped as `full-access` (default) or `read-only`, and may have
 * an optional expiry specified as a duration shorthand (`30d`, `12h`, `1y`) or
 * an RFC 3339 date.
 *
 * After generation the command offers to save `BUNNY_DATABASE_AUTH_TOKEN` (and
 * `BUNNY_DATABASE_URL` if missing) to the nearest `.env` file.
 *
 * @example
 * ```bash
 * # Generate a full-access token (interactive)
 * bunny db tokens create
 *
 * # Read-only token with 30-day expiry
 * bunny db tokens create db_01KCHBG8C5KSFGG0VRNFQ7EK7X --read-only --expiry 30d
 *
 * # Skip prompts and auto-save to .env
 * bunny db tokens create --force
 *
 * # Generate token without .env prompt
 * bunny db tokens create --no-save
 *
 * # JSON output for scripting
 * bunny db tokens create --output json
 * ```
 */
export const dbTokensCreateCommand = defineCommand<{
  [ARG_DATABASE_ID]?: string;
  [ARG_READ_ONLY]?: boolean;
  [ARG_EXPIRY]?: string;
  [ARG_SAVE]?: boolean;
  [ARG_FORCE]?: boolean;
}>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db tokens create", "Interactive — full-access token"],
    ["$0 db tokens create --read-only --expiry 30d", "Read-only with 30-day expiry"],
    ["$0 db tokens create --no-save", "Skip .env prompt"],
    ["$0 db tokens create --output json", "JSON output for scripting"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe:
          "Database ID (db_<ulid>). Auto-detected from BUNNY_DATABASE_URL in .env if omitted.",
      })
      .option(ARG_READ_ONLY, {
        type: "boolean",
        default: false,
        describe: "Generate a read-only token (default: full access)",
      })
      .option(ARG_EXPIRY, {
        alias: ARG_EXPIRY_ALIAS,
        type: "string",
        describe: "Token expiry (e.g. 30d, 12h, 1y, or RFC 3339 date)",
      })
      .option(ARG_SAVE, {
        type: "boolean",
        default: true,
        describe: "Prompt to save token to .env (use --no-save to skip)",
      })
      .option(ARG_FORCE, {
        alias: ARG_FORCE_ALIAS,
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompts",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    "read-only": readOnly,
    expiry,
    save,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createDbClient(clientOptions(config, verbose));

    const authorization = readOnly ? "read-only" : "full-access";
    const expiresAt = expiry ? parseExpiry(expiry) : null;

    const { id: databaseId, source } = await resolveDbId(client, databaseIdArg);

    if (source === "env") {
      logger.dim(`Database: ${databaseId} (from .env)`);
    }

    const spin = spinner("Generating token...");
    spin.start();

    // Fetch token and database details in parallel
    const [tokenResult, dbResult] = await Promise.all([
      client.PUT("/v2/databases/{db_id}/auth/generate", {
        params: { path: { db_id: databaseId } },
        body: { authorization, expires_at: expiresAt },
      }),
      client.GET("/v2/databases/{db_id}", {
        params: { path: { db_id: databaseId } },
      }),
    ]);

    spin.stop();

    const token = tokenResult.data?.token;
    const dbUrl = dbResult.data?.db?.url;

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            token,
            expires_at: tokenResult.data?.expires_at ?? null,
            db_id: databaseId,
            authorization,
          },
          null,
          2,
        ),
      );
      return;
    }

    const entries = [
      { key: "Token", value: token ?? "" },
      { key: "Access", value: authorization },
    ];
    if (source === "env") {
      entries.push({ key: "DB", value: `${databaseId} (from .env)` });
    }
    entries.push({
      key: "Expires",
      value: tokenResult.data?.expires_at ?? "never",
    });

    logger.success("Token generated.");
    logger.dim("  Existing tokens for this database remain valid.");
    logger.log();
    logger.log(formatKeyValue(entries, output));
    logger.log();

    // Offer to save to .env
    if (!token || !save) return;

    const existingToken = readEnvValue(ENV_DATABASE_AUTH_TOKEN);
    let shouldWrite = false;

    if (existingToken) {
      shouldWrite = await confirm(
        `${ENV_DATABASE_AUTH_TOKEN} already exists in ${existingToken.envPath} — overwrite?`,
        { force },
      );
    } else {
      shouldWrite = await confirm(`Save ${ENV_DATABASE_AUTH_TOKEN} to .env?`, { force });
    }

    if (shouldWrite) {
      const envPath = existingToken?.envPath;
      writeEnvValue(ENV_DATABASE_AUTH_TOKEN, token, envPath);

      if (dbUrl && !readEnvValue(ENV_DATABASE_URL)) {
        writeEnvValue(ENV_DATABASE_URL, dbUrl, envPath);
        logger.success(`Saved ${ENV_DATABASE_URL} and ${ENV_DATABASE_AUTH_TOKEN} to .env`);
      } else {
        logger.success(`Saved ${ENV_DATABASE_AUTH_TOKEN} to .env`);
      }
    }
  },
});
