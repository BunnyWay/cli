import { defineCommand } from "../../../core/define-command.ts";
import { readPassword } from "../../../core/ui.ts";
import { setProfile } from "../../../config/index.ts";
import { logger } from "../../../core/logger.ts";
import chalk from "chalk";

export const profileCreateCommand = defineCommand<{ "api-key"?: string }>({
  command: "create <name>",
  aliases: ["add"],
  describe: "Create a configuration profile.",

  builder: (yargs) =>
    yargs.option("api-key", {
      type: "string",
      describe: "API key (skips interactive prompt)",
    }),

  handler: async (args) => {
    const name = (args as any).name as string;
    let apiKey = args["api-key"];

    if (!apiKey) {
      logger.log(
        "The API key for your bunny.net account. It can be obtained at "
        + chalk.underline("https://dash.bunny.net/account/api-key"),
      );
      logger.log();

      apiKey = await readPassword("API key:");
    }

    if (!apiKey) {
      logger.error("API key is required.");
      process.exit(1);
    }

    setProfile(name, apiKey);
    logger.success(`Profile "${name}" saved.`);
  },
});
