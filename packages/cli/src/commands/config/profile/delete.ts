import { defineCommand } from "../../../core/define-command.ts";
import { deleteProfile } from "../../../config/index.ts";
import { logger } from "../../../core/logger.ts";

export const profileDeleteCommand = defineCommand({
  command: "delete <name>",
  describe: "Delete a configuration profile.",

  handler: async (args) => {
    const name = (args as any).name as string;

    deleteProfile(name);
    logger.success(`Profile "${name}" deleted.`);
  },
});
