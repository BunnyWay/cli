import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, removeManifest } from "../../core/manifest.ts";
import { confirm } from "../../core/ui.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

const COMMAND = "unlink";
const DESCRIPTION = `Remove .bunny/${APP_MANIFEST}, unlinking this directory.`;

interface UnlinkArgs {
  force?: boolean;
}

export const appsUnlinkCommand = defineCommand<UnlinkArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs.option("force", {
      alias: "f",
      type: "boolean",
      describe: "Skip the confirmation prompt",
    }),

  handler: async ({ force, output }) => {
    const existing = loadManifest<AppManifest>(APP_MANIFEST);

    if (!existing.id) {
      if (output === "json") {
        logger.log(JSON.stringify({ unlinked: false, reason: "no-manifest" }));
        return;
      }
      logger.log(`Nothing to unlink: no .bunny/${APP_MANIFEST} in this tree.`);
      return;
    }

    if (!force) {
      const confirmed = await confirm(`Unlink from ${existing.id}?`);
      if (!confirmed) {
        logger.log("Unlink cancelled.");
        return;
      }
    }

    removeManifest(APP_MANIFEST);

    if (output === "json") {
      logger.log(JSON.stringify({ unlinked: true, appId: existing.id }));
      return;
    }
    logger.success("Unlinked.");
  },
});
