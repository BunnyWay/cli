import { createComputeClient } from "@bunny.net/openapi-client";
import {
  type ScriptSelectorArgs,
  scriptIdOptionBuilder,
  selectScript,
} from "@/commands/scripts/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { pushEnvFile, reportPush } from "./env-push.ts";

const COMMAND = "push [file]";
const DESCRIPTION = "Push a local .env file to an Edge Script.";

const ARG_FILE = "file";
const ARG_ALL = "all";
const ARG_SECRETS = "secrets";
const ARG_PLAIN = "plain";

interface PushArgs extends ScriptSelectorArgs {
  [ARG_FILE]?: string;
  [ARG_ALL]?: boolean;
  [ARG_SECRETS]?: string[];
  [ARG_PLAIN]?: string[];
}

/**
 * Push variables from a local `.env` file to an Edge Script.
 *
 * Interactively picks which variables to push and which of them are secrets,
 * defaulting the secret choice from the variable name. `--all` skips both
 * pickers; `--secrets` and `--plain` override the guess by name.
 *
 * @example
 * ```bash
 * # Pick what to push from the nearest .env
 * bunny scripts env push
 *
 * # Push everything in a specific file, no prompts
 * bunny scripts env push .env.production --all
 *
 * # Force the secret/plain split
 * bunny scripts env push --all --secrets BUNNY_STORAGE_PASSWORD --plain API_URL
 * ```
 */
export const scriptsEnvPushCommand = defineCommand<PushArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts env push", "Pick what to push from the nearest .env"],
    ["$0 scripts env push .env.production --all", "Push a whole file"],
    [
      "$0 scripts env push --all --secrets DB_TOKEN",
      "Push everything, storing DB_TOKEN encrypted",
    ],
  ],

  builder: (yargs) =>
    scriptIdOptionBuilder(
      yargs.positional(ARG_FILE, {
        type: "string",
        describe: "Path to the .env file (defaults to the nearest .env)",
      }),
    )
      .option(ARG_ALL, {
        type: "boolean",
        describe: "Push every variable in the file without prompting",
      })
      .option(ARG_SECRETS, {
        type: "array",
        string: true,
        describe: "Names to store as encrypted secrets",
      })
      .option(ARG_PLAIN, {
        type: "array",
        string: true,
        describe: "Names to store as plain variables",
      }),

  handler: async ({
    [ARG_FILE]: file,
    [ARG_ALL]: all,
    [ARG_SECRETS]: secrets,
    [ARG_PLAIN]: plain,
    id: rawId,
    link,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const { id, offerLink } = await selectScript(client, {
      id: rawId,
      link,
      output,
    });

    const results = await pushEnvFile(client, id, {
      file,
      all,
      secrets,
      plain,
      output,
    });

    if (output === "json") {
      logger.log(JSON.stringify(results, null, 2));
      return;
    }

    reportPush(results);
    await offerLink();
  },
});
