import { createDbClient } from "@bunny.net/openapi-client";
import chalk from "chalk";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { readEnvValue } from "../../utils/env-file.ts";
import { generateToken } from "./api.ts";
import {
  ARG_DATABASE_ID,
  ENV_DATABASE_AUTH_TOKEN,
  ENV_DATABASE_URL,
} from "./constants.ts";
import {
  getSnippet,
  QUICKSTART_LANGUAGES,
  type QuickstartLang,
} from "./quickstart-snippets.ts";
import { resolveDbId } from "./resolve-db.ts";

const COMMAND = `quickstart [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Get started with a database in your project.";

const ARG_LANG = "lang";
const ARG_LANG_ALIAS = "l";
const ARG_URL = "url";
const ARG_TOKEN = "token";

/**
 * Generate a language-specific quickstart guide for connecting to a database.
 *
 * Resolves (or generates) the database URL and auth token, then prints a
 * step-by-step guide with `.env` values, install commands, and a ready-to-use
 * code snippet. Supports TypeScript, Go, Rust, and .NET.
 *
 * If `--url` and `--token` are provided, the API lookup is skipped entirely.
 *
 * @example
 * ```bash
 * # Interactive — prompts for language
 * bunny db quickstart
 *
 * # Non-interactive with explicit language
 * bunny db quickstart --lang typescript
 *
 * # Skip API lookup with pre-existing credentials
 * bunny db quickstart --lang go --url libsql://... --token ey...
 *
 * # JSON output for tooling integration
 * bunny db quickstart --output json
 * ```
 */
export const dbQuickstartCommand = defineCommand<{
  [ARG_DATABASE_ID]?: string;
  [ARG_LANG]?: string;
  [ARG_URL]?: string;
  [ARG_TOKEN]?: string;
}>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db quickstart", "Interactive — prompts for language"],
    ["$0 db quickstart --lang typescript", "Non-interactive"],
    [
      "$0 db quickstart --lang go --url libsql://… --token ey…",
      "Skip API lookup",
    ],
    ["$0 db quickstart --output json", "JSON output for tooling"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe:
          "Database ID (db_<ulid>). Auto-detected from BUNNY_DATABASE_URL in .env if omitted.",
      })
      .option(ARG_LANG, {
        alias: ARG_LANG_ALIAS,
        type: "string",
        choices: QUICKSTART_LANGUAGES.map((l) => l.id) as string[],
        describe: "Language for the code snippet",
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
    lang: langArg,
    url: urlArg,
    token: tokenArg,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    // Language selection
    let lang: QuickstartLang | undefined = langArg as
      | QuickstartLang
      | undefined;
    if (!lang) {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "Language:",
        choices: QUICKSTART_LANGUAGES.map((l) => ({
          title: l.title,
          value: l.id,
        })),
      });
      lang = value;
    }
    if (!lang) throw new UserError("Language selection is required.");

    const snippet = getSnippet(lang);

    let url = urlArg;
    let token = tokenArg;
    let dbName: string | undefined;

    // Resolve URL and token from API if not provided via flags
    if (!url || !token) {
      const config = resolveConfig(profile, apiKey, verbose);
      const client = createDbClient(clientOptions(config, verbose));

      const { id: databaseId } = await resolveDbId(client, databaseIdArg);

      const spin = spinner("Fetching database details...");
      spin.start();

      const fetches: Promise<any>[] = [
        client.GET("/v2/databases/{db_id}", {
          params: { path: { db_id: databaseId } },
        }),
      ];

      if (!token) {
        spin.text = "Generating token...";
        fetches.push(
          generateToken(client, databaseId, {
            authorization: "full-access",
            expiresAt: null,
          }),
        );
      }

      const [dbResult, tokenResult] = await Promise.all(fetches);

      spin.stop();

      const db = dbResult.data?.db;
      dbName = db?.name;
      if (!url) url = db?.url;
      if (!token && tokenResult) token = tokenResult.token;
    }

    if (!url || !token) {
      throw new UserError("Could not resolve database URL or generate token.");
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            name: dbName ?? null,
            url,
            token,
            lang: snippet.lang,
            install: snippet.install,
            code: snippet.code,
            env: {
              [ENV_DATABASE_URL]: url,
              [ENV_DATABASE_AUTH_TOKEN]: token,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.info(`Quickstart for ${dbName ?? "database"} (${snippet.lang})`);
    logger.log();

    const hasUrl = !!readEnvValue(ENV_DATABASE_URL);
    const hasToken = !!readEnvValue(ENV_DATABASE_AUTH_TOKEN);
    const envReady = hasUrl && hasToken;
    let step = 1;

    // .env variables — skip if both already present
    if (!envReady) {
      logger.log(chalk.bold(`  ${step}. Add to your .env`));
      logger.log();
      logger.log(chalk.gray("     # .env"));
      if (!hasUrl) logger.log(`     ${ENV_DATABASE_URL}=${url}`);
      if (!hasToken) logger.log(`     ${ENV_DATABASE_AUTH_TOKEN}=${token}`);
      logger.log();
      step++;
    }

    // Install
    logger.log(chalk.bold(`  ${step}. Install the client`));
    logger.log();
    logger.log(`     ${chalk.gray("$")} ${snippet.install}`);
    logger.log();
    step++;

    // Code snippet
    logger.log(chalk.bold(`  ${step}. Connect`));
    logger.log();
    for (const line of snippet.code.split("\n")) {
      logger.log(`     ${line}`);
    }
    logger.log();
  },
});
