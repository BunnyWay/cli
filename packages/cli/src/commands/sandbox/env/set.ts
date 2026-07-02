import { SandboxError } from "@bunny.net/sandbox";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { collectEnv } from "../env-args.ts";
import { sandboxFromName } from "./resolve.ts";

interface SetArgs {
  name: string;
  pairs?: string[];
  envFile?: string;
}

export const sandboxEnvSetCommand = defineCommand<SetArgs>({
  command: "set <name> [pairs..]",
  describe: "Persist environment variables on a sandbox.",
  examples: [
    ["$0 sandbox env set my-sandbox NODE_ENV=production", "Set a variable"],
    ["$0 sandbox env set my-sandbox A=1 B=2", "Set multiple variables"],
    [
      "$0 sandbox env set my-sandbox --env-file .env",
      "Load variables from a dotenv file",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "Sandbox name",
      })
      .positional("pairs", {
        type: "string",
        array: true,
        describe: "Variables as KEY=VALUE",
      })
      .option("env-file", {
        type: "string",
        describe: "Load environment variables from a dotenv file",
      }),

  handler: async ({
    name,
    pairs,
    envFile,
    profile,
    apiKey,
    verbose,
    output,
  }) => {
    const vars = await collectEnv(pairs, envFile);
    if (Object.keys(vars).length === 0) {
      throw new UserError("Provide at least one KEY=VALUE pair or --env-file.");
    }

    const sandbox = sandboxFromName(name, profile, apiKey, verbose);

    const spin = spinner("Updating environment...");
    spin.start();
    try {
      await sandbox.setEnv(vars);
    } catch (err) {
      spin.stop();
      if (err instanceof SandboxError) throw new UserError(err.message);
      throw err;
    }
    spin.stop();

    const keys = Object.keys(vars);
    if (output === "json") {
      logger.log(JSON.stringify({ updated: keys }, null, 2));
      return;
    }
    logger.log(`Persisted ${keys.length} variable(s): ${keys.join(", ")}`);
    logger.info("The sandbox is redeploying to apply the change.");
  },
});
