import { dbTokensCreate } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatKeyValue } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { confirm } from "../../../core/ui.ts";
import { readEnvValue, writeEnvValue } from "../../../utils/env-file.ts";
import {
  ARG_DATABASE_ID,
  ENV_DATABASE_AUTH_TOKEN,
  ENV_DATABASE_URL,
} from "../constants.ts";
import { resolveDbId } from "../resolve-db.ts";

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
    const [, amountStr, unitStr] = match;
    const amount = parseInt(amountStr ?? "0", 10);
    const unit = unitStr?.toLowerCase();
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
  if (Number.isNaN(parsed.getTime())) {
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
export const dbTokensCreateCommand = defineActionCommand({
  action: dbTokensCreate,
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db tokens create", "Interactive — full-access token"],
    [
      "$0 db tokens create --read-only --expiry 30d",
      "Read-only with 30-day expiry",
    ],
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

  progress: "Generating token...",

  prepare: async (args, ctx) => {
    const { id, name, source } = await resolveDbId(
      ctx.clients.db,
      args[ARG_DATABASE_ID],
    );

    const label = name ? `${name} (${id})` : id;
    if (source === "env") {
      logger.dim(`Database: ${label} (from .env)`);
    } else if (source === "manifest") {
      logger.dim(`Database: ${label} (from .bunny/database.json)`);
    }

    return {
      input: {
        database: id,
        readOnly: args["read-only"],
        expiresAt: args.expiry ? parseExpiry(args.expiry) : null,
      },
    };
  },

  // Offer to save the token to .env. Skipped for json output (must stay unprompted).
  after: async (token, args) => {
    if (args.output === "json" || !token.token || !args.save) return;

    const existingToken = readEnvValue(ENV_DATABASE_AUTH_TOKEN);
    const shouldWrite = existingToken
      ? await confirm(
          `${ENV_DATABASE_AUTH_TOKEN} already exists in ${existingToken.envPath} — overwrite?`,
          { force: args.force },
        )
      : await confirm(`Save ${ENV_DATABASE_AUTH_TOKEN} to .env?`, {
          force: args.force,
        });
    if (!shouldWrite) return;

    const envPath = existingToken?.envPath;
    writeEnvValue(ENV_DATABASE_AUTH_TOKEN, token.token, envPath);
    if (token.databaseUrl && !readEnvValue(ENV_DATABASE_URL)) {
      writeEnvValue(ENV_DATABASE_URL, token.databaseUrl, envPath);
      logger.success(
        `Saved ${ENV_DATABASE_URL} and ${ENV_DATABASE_AUTH_TOKEN} to .env`,
      );
    } else {
      logger.success(`Saved ${ENV_DATABASE_AUTH_TOKEN} to .env`);
    }
  },

  json: (token) => ({
    token: token.token,
    expires_at: token.expiresAt,
    db_id: token.database,
    authorization: token.authorization,
  }),

  render: (token, { output }) => {
    const entries = [
      { key: "Token", value: token.token },
      { key: "Access", value: token.authorization },
      { key: "Expires", value: token.expiresAt ?? "never" },
    ];

    logger.success("Token generated.");
    logger.dim("  Existing tokens for this database remain valid.");
    logger.log();
    logger.log(formatKeyValue(entries, output));
    logger.log();
  },
});
