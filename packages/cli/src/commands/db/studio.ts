import { createDbClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { readEnvValue } from "../../utils/env-file.ts";
import {
  ARG_DATABASE_ID,
  ENV_DATABASE_AUTH_TOKEN,
  ENV_DATABASE_URL,
} from "./constants.ts";
import { resolveDbId } from "./resolve-db.ts";

const COMMAND = `studio [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Open a visual database explorer in your browser.";

const ARG_PORT = "port";
const ARG_URL = "url";
const ARG_TOKEN = "token";
const ARG_NO_OPEN = "no-open";
const ARG_DEV = "dev";
const ARG_FORCE = "force";
const ARG_FORCE_ALIAS = "f";

const TOKEN_TTL_MINUTES = 30;

/**
 * Resolve database credentials — same pattern as shell.ts.
 */
async function resolveCredentials(
  urlArg: string | undefined,
  tokenArg: string | undefined,
  databaseIdArg: string | undefined,
  profile: string,
  apiKeyOverride?: string,
  verbose = false,
): Promise<{ url: string; token: string; databaseId: string | undefined }> {
  let url = urlArg ?? readEnvValue(ENV_DATABASE_URL)?.value;
  let token = tokenArg ?? readEnvValue(ENV_DATABASE_AUTH_TOKEN)?.value;

  if (url && token) return { url, token, databaseId: databaseIdArg };

  const config = resolveConfig(profile, apiKeyOverride);
  const apiClient = createDbClient(clientOptions(config, verbose));

  const { id: databaseId } = await resolveDbId(apiClient, databaseIdArg);

  const spin = spinner("Connecting...");
  spin.start();

  const fetches: Promise<any>[] = [];

  if (!url) {
    fetches.push(
      apiClient.GET("/v2/databases/{db_id}", {
        params: { path: { db_id: databaseId } },
      }),
    );
  } else {
    fetches.push(Promise.resolve(null));
  }

  if (!token) {
    spin.text = "Generating token...";
    const expiresAt = new Date(
      Date.now() + TOKEN_TTL_MINUTES * 60 * 1000,
    ).toISOString();
    fetches.push(
      apiClient.PUT("/v2/databases/{db_id}/auth/generate", {
        params: { path: { db_id: databaseId } },
        body: { authorization: "full-access", expires_at: expiresAt },
      }),
    );
  }

  const [dbResult, tokenResult] = await Promise.all(fetches);

  spin.stop();

  if (!url && dbResult) url = dbResult.data?.db?.url;
  if (!token && tokenResult) token = tokenResult.data?.token;

  if (!url || !token) {
    throw new UserError("Could not resolve database URL or generate token.");
  }

  return { url, token, databaseId };
}

export const dbStudioCommand = defineCommand<{
  [ARG_DATABASE_ID]?: string;
  [ARG_PORT]?: number;
  [ARG_URL]?: string;
  [ARG_TOKEN]?: string;
  [ARG_NO_OPEN]?: boolean;
  [ARG_DEV]?: boolean;
  [ARG_FORCE]?: boolean;
}>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db studio", "Open studio (auto-detect from .env)"],
    ["$0 db studio --port 3000", "Use a custom port"],
    ["$0 db studio db_abc123", "Open studio for a specific database"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe:
          "Database ID (db_<ulid>). Auto-detected from BUNNY_DATABASE_URL in .env if omitted.",
      })
      .option(ARG_PORT, {
        type: "number",
        default: 4488,
        describe: "Port for the studio server",
      })
      .option(ARG_URL, {
        type: "string",
        describe: "Database URL (skips API lookup)",
      })
      .option(ARG_TOKEN, {
        type: "string",
        describe: "Auth token (skips token generation)",
      })
      .option(ARG_NO_OPEN, {
        type: "boolean",
        default: false,
        describe: "Don't automatically open the browser",
      })
      .option(ARG_DEV, {
        type: "boolean",
        default: false,
        hidden: true,
      })
      .option(ARG_FORCE, {
        alias: ARG_FORCE_ALIAS,
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompts",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    [ARG_PORT]: port,
    [ARG_URL]: urlArg,
    [ARG_TOKEN]: tokenArg,
    [ARG_NO_OPEN]: noOpen,
    [ARG_DEV]: dev,
    [ARG_FORCE]: force,
    profile,
    verbose,
    apiKey,
  }) => {
    logger.warn("db studio will:");
    logger.log(
      `  - Create a full-access token scoped to this database that expires in ${TOKEN_TTL_MINUTES} minutes.`,
    );
    logger.log(
      "  - Load that token into a browser tab running on http://localhost.",
    );
    logger.log(
      "  - Power the UI with additional reads (table previews, row counts, pagination),",
    );
    logger.log("    which counts against your read quota.");
    logger.log("");

    const confirmed = await confirm("Continue?", { force });
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const { createClient } = await import("@libsql/client/web");
    const { startStudio } = await import("@bunny.net/database-studio");

    const { url, token } = await resolveCredentials(
      urlArg,
      tokenArg,
      databaseIdArg,
      profile,
      apiKey,
      verbose,
    );

    const client = createClient({ url, authToken: token });

    logger.log("");
    await startStudio({
      client,
      port: port ?? 4488,
      open: !noOpen,
      dev,
      logger: {
        log: (msg: string) => logger.log(msg),
        error: (msg: string) => logger.error(msg),
      },
    });
  },
});
