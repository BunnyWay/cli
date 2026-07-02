import { SandboxError } from "@bunny.net/sandbox";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { sandboxFromName } from "./resolve.ts";

interface DeleteArgs {
  name: string;
  keys: string[];
}

export const sandboxEnvDeleteCommand = defineCommand<DeleteArgs>({
  command: "delete <name> <keys..>",
  aliases: ["rm", "unset"],
  describe: "Remove persisted environment variables from a sandbox.",
  examples: [
    ["$0 sandbox env delete my-sandbox NODE_ENV", "Remove a variable"],
    ["$0 sandbox env rm my-sandbox A B", "Remove multiple variables"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "Sandbox name",
      })
      .positional("keys", {
        type: "string",
        array: true,
        demandOption: true,
        describe: "Variable names to remove",
      }),

  handler: async ({ name, keys, profile, apiKey, verbose, output }) => {
    const sandbox = sandboxFromName(name, profile, apiKey, verbose);

    const spin = spinner("Updating environment...");
    spin.start();
    let removed: string[];
    try {
      removed = await sandbox.unsetEnv(keys);
    } catch (err) {
      spin.stop();
      if (err instanceof SandboxError) throw new UserError(err.message);
      throw err;
    }
    spin.stop();

    const missing = keys.filter((key) => !removed.includes(key));

    if (removed.length === 0) {
      throw new UserError(
        `No matching variable(s) to remove: ${missing.join(", ")}`,
      );
    }

    if (output === "json") {
      logger.log(JSON.stringify({ removed, missing }, null, 2));
      return;
    }
    logger.log(`Removed ${removed.length} variable(s): ${removed.join(", ")}`);
    if (missing.length > 0) {
      logger.warn(`Not set (ignored): ${missing.join(", ")}`);
    }
    logger.info("The sandbox is redeploying to apply the change.");
  },
});
