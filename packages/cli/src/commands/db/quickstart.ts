import { createDbClient } from "@bunny.net/api";
import chalk from "chalk";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { readEnvValue } from "../../utils/env-file.ts";
import { ARG_DATABASE_ID } from "./constants.ts";
import { resolveDbId } from "./resolve-db.ts";

const COMMAND = `quickstart [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Get started with a database in your project.";

const ARG_LANG = "lang";
const ARG_LANG_ALIAS = "l";
const ARG_URL = "url";
const ARG_TOKEN = "token";

interface Snippet {
  lang: string;
  install: string;
  code: string;
}

const LANGUAGES = [
  { id: "typescript", title: "TypeScript" },
  { id: "go", title: "Go" },
  { id: "rust", title: "Rust" },
  { id: "dotnet", title: ".NET" },
] as const;

type LangId = (typeof LANGUAGES)[number]["id"];

/** Return the install command and connection code snippet for a given language. */
function getSnippet(lang: string): Snippet {
  switch (lang) {
    case "typescript":
      return {
        lang: "TypeScript",
        install: "bun add @libsql/client",
        code: `import { createClient } from "@libsql/client/web";

const client = createClient({
  url: process.env.BUNNY_DATABASE_URL,
  authToken: process.env.BUNNY_DATABASE_AUTH_TOKEN,
});

await client.execute("SELECT * FROM users");`,
      };
    case "go":
      return {
        lang: "Go",
        install: "go get github.com/tursodatabase/libsql-client-go/libsql",
        code: `package main

import (
\t"database/sql"
\t"fmt"
\t"os"

\t_ "github.com/tursodatabase/libsql-client-go/libsql"
)

func main() {
\turl := fmt.Sprintf("%s?authToken=%s",
\t\tos.Getenv("BUNNY_DATABASE_URL"),
\t\tos.Getenv("BUNNY_DATABASE_AUTH_TOKEN"),
\t)

\tdb, err := sql.Open("libsql", url)
\tif err != nil {
\t\tfmt.Fprintf(os.Stderr, "failed to open db %s: %s", url, err)
\t\tos.Exit(1)
\t}
\tdefer db.Close()
}`,
      };
    case "rust":
      return {
        lang: "Rust",
        install: "cargo add libsql",
        code: `use libsql::Builder;

let url = std::env::var("BUNNY_DATABASE_URL").expect("BUNNY_DATABASE_URL must be set");
let token = std::env::var("BUNNY_DATABASE_AUTH_TOKEN").expect("BUNNY_DATABASE_AUTH_TOKEN must be set");

let db = Builder::new_remote(url, token)
    .build()
    .await?;

let conn = db.connect()?;

let mut rows = conn.query("SELECT * FROM users", ()).await?;

while let Some(row) = rows.next().await? {
    let id: i64 = row.get(0)?;
    let name: String = row.get(1)?;
    println!("User: {} - {}", id, name);
}`,
      };
    case "dotnet":
      return {
        lang: ".NET",
        install: "dotnet add package Bunny.LibSql.Client",
        code: `var db = new AppDb(
    Environment.GetEnvironmentVariable("BUNNY_DATABASE_URL"),
    Environment.GetEnvironmentVariable("BUNNY_DATABASE_AUTH_TOKEN")
);

await db.ApplyMigrationsAsync();

var users = await db.Users.ToListAsync();

foreach (var user in users)
{
    Console.WriteLine($"User: {user.name}");
}`,
      };
    default:
      throw new UserError(
        `Unsupported language: "${lang}"`,
        `Supported: ${LANGUAGES.map((l) => l.id).join(", ")}`,
      );
  }
}

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
        choices: LANGUAGES.map((l) => l.id) as string[],
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
    let lang: LangId | undefined = langArg as LangId | undefined;
    if (!lang) {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "Language:",
        choices: LANGUAGES.map((l) => ({
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
      const config = resolveConfig(profile, apiKey);
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
          client.PUT("/v2/databases/{db_id}/auth/generate", {
            params: { path: { db_id: databaseId } },
            body: { authorization: "full-access", expires_at: null },
          }),
        );
      }

      const [dbResult, tokenResult] = await Promise.all(fetches);

      spin.stop();

      const db = dbResult.data?.db;
      dbName = db?.name;
      if (!url) url = db?.url;
      if (!token && tokenResult) token = tokenResult.data?.token;
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
              BUNNY_DATABASE_URL: url,
              BUNNY_DATABASE_AUTH_TOKEN: token,
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

    const hasUrl = !!readEnvValue("BUNNY_DATABASE_URL");
    const hasToken = !!readEnvValue("BUNNY_DATABASE_AUTH_TOKEN");
    const envReady = hasUrl && hasToken;
    let step = 1;

    // .env variables — skip if both already present
    if (!envReady) {
      logger.log(chalk.bold(`  ${step}. Add to your .env`));
      logger.log();
      logger.log(chalk.dim("     # .env"));
      if (!hasUrl) logger.log(`     BUNNY_DATABASE_URL=${url}`);
      if (!hasToken) logger.log(`     BUNNY_DATABASE_AUTH_TOKEN=${token}`);
      logger.log();
      step++;
    }

    // Install
    logger.log(chalk.bold(`  ${step}. Install the client`));
    logger.log();
    logger.log(`     ${chalk.dim("$")} ${snippet.install}`);
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
