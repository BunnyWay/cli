import chalk from "chalk";
import { setProfile } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { readPassword } from "@/core/ui.ts";

export const configInitCommand = defineCommand<{ "api-key"?: string }>({
  command: "init",
  describe: "Initialize configuration with an API key.",
  examples: [
    ["$0 config init", "Prompt for the API key"],
    ["$0 config init --api-key $BUNNYNET_API_KEY", "Skip the prompt"],
    [
      "$0 config init --profile staging --api-key $BUNNYNET_API_KEY",
      "Save the key to a named profile",
    ],
  ],

  builder: (yargs) =>
    yargs.option("api-key", {
      type: "string",
      describe: "API key (skips interactive prompt)",
    }),

  handler: async ({ profile, "api-key": apiKeyFlag }) => {
    let apiKey = apiKeyFlag;

    if (!apiKey) {
      logger.log(
        "The API key for your bunny.net account. It can be obtained at " +
          chalk.underline("https://dash.bunny.net/account/api-key"),
      );
      logger.log();

      apiKey = await readPassword("API key:");
    }

    if (!apiKey) {
      logger.error("API key is required.");
      process.exit(1);
    }

    setProfile(profile, apiKey);
    logger.success(`Profile "${profile}" saved.`);
  },
});
