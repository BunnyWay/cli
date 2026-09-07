import { deleteProfile, profileExists } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { ConfigError, UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable } from "@/core/ui.ts";

export const profileDeleteCommand = defineCommand<{
  name: string;
  force: boolean;
}>({
  command: "delete <name>",
  describe: "Delete a configuration profile.",

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "Profile to delete",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Skip confirmation",
      }),

  preRun: async ({ name }) => {
    if (!profileExists(name)) {
      throw new ConfigError(
        `Profile "${name}" not found.`,
        "Run `bunny config profile list` to see available profiles.",
      );
    }
  },

  handler: async ({ name, force, output }) => {
    requireConfirmable(output, {
      force,
      message: `Deleting profile "${name}" requires confirmation.`,
      hint: "Re-run with --force to delete non-interactively.",
    });
    if (
      !(await confirm(`Delete profile "${name}" and its stored credentials?`, {
        force,
      }))
    ) {
      throw new UserError("Profile deletion cancelled.");
    }

    deleteProfile(name);
    if (output === "json") {
      logger.log(JSON.stringify({ profile: name, deleted: true }));
      return;
    }
    logger.success(`Profile "${name}" deleted.`);
  },
});
