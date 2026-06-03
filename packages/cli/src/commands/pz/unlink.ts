import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { removeManifest } from "../../core/manifest.ts";
import { PULL_ZONE_MANIFEST } from "./constants.ts";

export const pzUnlinkCommand = defineCommand({
  command: "unlink",
  describe: "Unlink the current directory from its pull zone.",
  examples: [
    ["$0 pz unlink", "Unlink the current pull zone"],
  ],

  handler: async ({ output }) => {
    removeManifest(PULL_ZONE_MANIFEST);

    if (output === "json") {
      logger.log(JSON.stringify({ unlinked: true }));
      return;
    }

    logger.success("Pull zone unlinked.");
  },
});
