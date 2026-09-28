import { Sandbox, SandboxError } from "@bunny.net/sandbox";
import { deleteSandbox, getSandbox, resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm, spinner } from "@/core/ui.ts";

interface DeleteArgs {
  name: string;
  force: boolean;
  output?: string;
}

export const sandboxDeleteCommand = defineCommand<DeleteArgs>({
  command: "delete <name>",
  aliases: ["rm"],
  describe: "Delete a sandbox and its MC app.",
  examples: [
    ["$0 sandbox delete my-sandbox", "Delete a sandbox"],
    ["$0 sandbox delete my-sandbox --force", "Delete without confirmation"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "Sandbox name",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompt",
      }),

  handler: async ({ name, force, output, profile, verbose, apiKey }) => {
    const record = getSandbox(name);
    if (!record) {
      throw new UserError(`No sandbox named "${name}" found.`);
    }

    if (!force && output !== "json") {
      const ok = await confirm(
        `Delete sandbox "${name}" (app ${record.app_id})?`,
      );
      if (!ok) {
        logger.info("Aborted.");
        return;
      }
    }

    const config = resolveConfig(profile, apiKey, verbose);

    const spin = spinner("Deleting sandbox...");
    spin.start();

    try {
      const sandbox = Sandbox.fromHandle(
        {
          appId: record.app_id,
          name,
          agentToken: record.agent_token,
          sshHost: record.ssh_host ?? "",
        },
        {
          apiKey: config.apiKey,
          apiUrl: config.apiUrl,
          verbose,
          onDebug: (msg) => logger.debug(msg, true),
        },
      );
      await sandbox.delete();
    } catch (err) {
      spin.stop();
      if (err instanceof SandboxError) throw new UserError(err.message);
      throw err;
    }

    spin.stop();
    deleteSandbox(name);

    if (output === "json") {
      logger.log(JSON.stringify({ deleted: true, name }, null, 2));
      return;
    }

    logger.log(`Sandbox "${name}" deleted.`);
  },
});
