import { deleteProfile, requireProfile } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { confirm } from "@/core/ui.ts";

export const authLogoutCommand = defineCommand<{ force: boolean }>({
  command: "logout",
  describe: "Remove a stored authentication profile.",
  examples: [
    ["$0 logout", "Log out of the default profile"],
    ["$0 logout --profile staging", "Log out of a named profile"],
    ["$0 logout --force", "Skip the confirmation prompt"],
  ],

  builder: (yargs) =>
    yargs.option("force", {
      type: "boolean",
      default: false,
      describe: "Skip confirmation",
    }),

  preRun: async ({ profile }) => requireProfile(profile),

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
