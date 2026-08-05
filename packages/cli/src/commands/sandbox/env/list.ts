import { SandboxError } from "@bunny.net/sandbox";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { sandboxFromName } from "../resolve.ts";

interface ListArgs {
  name: string;
}

export const sandboxEnvListCommand = defineCommand<ListArgs>({
  command: "list <name>",
  aliases: ["ls"],
  describe: "List persisted environment variables for a sandbox.",
  examples: [["$0 sandbox env list my-sandbox", "List all variables"]],

  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      demandOption: true,
      describe: "Sandbox name",
    }),

  handler: async ({ name, profile, apiKey, verbose, output }) => {
    const sandbox = sandboxFromName(name, profile, apiKey, verbose);

    const spin = spinner("Fetching environment...");
    spin.start();
    let env: Record<string, string>;
    try {
      env = await sandbox.getEnv();
    } catch (err) {
      spin.stop();
      if (err instanceof SandboxError) throw new UserError(err.message);
      throw err;
    }
    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(env, null, 2));
      return;
    }

    const keys = Object.keys(env).sort();
    if (keys.length === 0) {
      logger.info("No environment variables set.");
      return;
    }
    logger.log(
      formatTable(
        ["Name", "Value"],
        keys.map((key) => [key, env[key] ?? ""]),
        output,
      ),
    );
  },
});
