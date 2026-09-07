import { deleteProfile, profileExists } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm } from "@/core/ui.ts";

interface DeleteArgs {
  name: string;
  force: boolean;
}

export const profileDeleteCommand = defineCommand<DeleteArgs>({
  command: "delete <name>",
  aliases: ["rm"],
  describe: "Delete a configuration profile.",

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "Profile name",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Skip confirmation",
      }),

  preRun: async ({ name }) => {
    if (!profileExists(name)) {
      throw new UserError(
        `Profile "${name}" not found.`,
        'Run "bunny config profile list" to see your profiles.',
      );
    }
  },

  handler: async ({ name, force }) => {
    const ok = await confirm(
      `Delete profile "${name}" and its stored API key?`,
      { force },
    );
    if (!ok) {
      logger.log("Cancelled.");
      process.exit(1);
    }

    deleteProfile(name);
    logger.success(`Profile "${name}" deleted.`);
  },
});
