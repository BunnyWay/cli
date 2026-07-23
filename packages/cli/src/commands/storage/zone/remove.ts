import { storageZonesDelete } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { logger } from "../../../core/logger.ts";
import { loadManifest, removeManifest } from "../../../core/manifest.ts";
import { confirm, confirmTyped } from "../../../core/ui.ts";
import { STORAGE_MANIFEST, type StorageZoneManifest } from "../constants.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

export const storageZoneRemoveCommand = defineActionCommand({
  action: storageZonesDelete,
  command: "remove [zone]",
  aliases: ["rm"],
  describe: "Delete a storage zone and all of its files.",
  examples: [
    ["$0 storage zones remove my-zone", "Delete a zone"],
    ["$0 storage zones remove my-zone --force", "Skip confirmation"],
    ["$0 storage zones remove", "Pick a zone interactively"],
  ],

  builder: (yargs) =>
    yargs
      .positional("zone", {
        type: "string",
        describe: "Storage zone name or ID",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompt",
      }),

  progress: "Deleting storage zone...",

  prepare: async ({ zone: ref, force, output }, ctx) => {
    // Destructive: --force must not silently delete a picked zone, so it disables the picker.
    const zone = await resolveStorageZoneInteractive(ctx.clients.core, ref, {
      output,
      force,
    });

    return {
      input: { zone: String(zone.Id) },
      confirm: async () => {
        const agreed = await confirm(
          `Delete storage zone ${zone.Name} and all ${zone.FilesStored ?? 0} file(s)? This cannot be undone.`,
          { force },
        );
        if (!agreed) return false;
        // Deleting a zone destroys its files, so require typing the name too.
        return confirmTyped(zone.Name ?? "", { force });
      },
    };
  },

  // Drop a manifest that pointed at the deleted zone so later commands don't resolve a ghost.
  after: (result) => {
    const manifest = loadManifest<StorageZoneManifest>(STORAGE_MANIFEST);
    if (manifest.id !== result.id) return;
    removeManifest(STORAGE_MANIFEST);
    logger.dim(`Removed stale .bunny/${STORAGE_MANIFEST}.`);
  },

  render: (result) => {
    logger.success(`Deleted storage zone ${result.name}.`);
  },
});
