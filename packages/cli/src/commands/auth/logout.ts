import { defineCommand } from "../../core/define-command.ts";
import { profileExists, deleteProfile } from "../../config/index.ts";
import { confirm } from "../../core/ui.ts";
import { logger } from "../../core/logger.ts";
import { UserError } from "../../core/errors.ts";

export const authLogoutCommand = defineCommand<{ force: boolean }>({
  command: "logout",
  describe: "Remove a stored authentication profile.",

  builder: (yargs) =>
    yargs.option("force", {
      type: "boolean",
      default: false,
      describe: "Skip confirmation",
    }),

  preRun: async ({ profile }) => {
    if (!profileExists(profile)) {
      throw new UserError(`Profile "${profile}" not found.`);
    }
  },

  handler: async ({ profile, force }) => {
    logger.info(`Logging out of profile "${profile}".`);

    const ok = await confirm("Are you sure?", { force });
    if (!ok) {
      logger.log("Logout cancelled.");
      process.exit(1);
    }

    deleteProfile(profile);
    logger.success(`Profile "${profile}" removed.`);
  },
});
