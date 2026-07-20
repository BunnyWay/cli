import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, removeManifest } from "../../core/manifest.ts";
import { confirm, isInteractive } from "../../core/ui.ts";
import { STORAGE_MANIFEST, type StorageZoneManifest } from "./constants.ts";

interface UnlinkArgs {
  force?: boolean;
}

export const storageUnlinkCommand = defineCommand<UnlinkArgs>({
  command: "unlink",
  describe: `Remove .bunny/${STORAGE_MANIFEST}, unlinking this directory from its storage zone.`,

  builder: (yargs) =>
    yargs.option("force", {
      alias: "f",
      type: "boolean",
      describe: "Skip the confirmation prompt",
    }),

  handler: async ({ force, output }) => {
    const existing = loadManifest<StorageZoneManifest>(STORAGE_MANIFEST);

    if (!existing.id) {
      if (output === "json") {
        logger.log(JSON.stringify({ unlinked: false, reason: "no-manifest" }));
        return;
      }
      logger.log(
        `Nothing to unlink: no .bunny/${STORAGE_MANIFEST} in this tree.`,
      );
      return;
    }

    if (!force) {
      // Non-interactive (json output or no TTY) can't answer the prompt; require --force instead of silently no-op.
      if (!isInteractive(output)) {
        throw new UserError(
          "Unlinking requires confirmation.",
          "Re-run with --force to unlink non-interactively.",
        );
      }
      const confirmed = await confirm(
        `Unlink from ${existing.name ?? existing.id}?`,
      );
      if (!confirmed) {
        logger.log("Unlink cancelled.");
        return;
      }
    }

    removeManifest(STORAGE_MANIFEST);

    if (output === "json") {
      logger.log(JSON.stringify({ unlinked: true, id: existing.id }));
      return;
    }
    logger.success("Unlinked.");
  },
});
