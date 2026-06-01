import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { removeManifest } from "../../core/manifest.ts";
import { PULL_ZONE_MANIFEST } from "./constants.ts";

export const pullzonesDeselectCommand = defineCommand({
  command: "deselect",
  describe: "Clear the active pull zone context.",
  examples: [
    ["$0 pullzones deselect", "Deselect the current pull zone"],
  ],

  handler: async ({ output }) => {
    removeManifest(PULL_ZONE_MANIFEST);

    if (output === "json") {
      logger.log(JSON.stringify({ deselected: true }));
      return;
    }

    logger.success("Pull zone deselected.");
  },
});
