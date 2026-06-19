import { createMcClient } from "@bunny.net/openapi-client";
import {
  deleteSandbox,
  getSandbox,
  resolveConfig,
} from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { confirm, spinner } from "../../core/ui.ts";

interface DeleteArgs {
  name: string;
  force: boolean;
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

  handler: async ({ name, force, profile, verbose, apiKey }) => {
    const record = getSandbox(name);
    if (!record) {
      throw new UserError(`No sandbox named "${name}" found.`);
    }

    if (!force) {
      const ok = await confirm(
        `Delete sandbox "${name}" (app ${record.app_id})?`,
      );
      if (!ok) {
        logger.info("Aborted.");
        return;
      }
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Deleting sandbox...");
    spin.start();

    const { error } = await client.DELETE("/apps/{appId}", {
      params: { path: { appId: record.app_id } },
    });

    spin.stop();

    if (error) {
      throw new UserError(`Failed to delete app: ${JSON.stringify(error)}`);
    }

    deleteSandbox(name);
    logger.log(`Sandbox "${name}" deleted.`);
  },
});
