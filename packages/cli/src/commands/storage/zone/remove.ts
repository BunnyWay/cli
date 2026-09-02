import { createCoreClient } from "@bunny.net/openapi-client";
import {
  STORAGE_MANIFEST,
  type StorageZoneManifest,
} from "@/commands/storage/constants.ts";
import { resolveStorageZoneInteractive } from "@/commands/storage/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, removeManifest } from "@/core/manifest.ts";
import { confirm, prompts, spinner } from "@/core/ui.ts";

interface ZoneRemoveArgs {
  zone?: string;
  force?: boolean;
}

export const storageZoneRemoveCommand = defineCommand<ZoneRemoveArgs>({
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

  handler: async ({ zone: ref, force, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // Destructive: --force must not silently delete a picked zone, so it disables the picker.
    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      force,
    });

    const confirmed = await confirm(
      `Delete storage zone ${zone.Name} and all ${zone.FilesStored ?? 0} file(s)? This cannot be undone.`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    // Second confirmation: deleting a zone destroys its files, so require typing the name unless --force.
    if (!force) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: `Type "${zone.Name}" to confirm:`,
      });
      if (value !== (zone.Name ?? "")) {
        logger.log("Cancelled.");
        return;
      }
    }

    const removeSpin = spinner("Deleting storage zone...");
    removeSpin.start();
    try {
      await client.DELETE("/storagezone/{id}", {
        params: { path: { id: zone.Id as number } },
      });
    } finally {
      removeSpin.stop();
    }

    // Drop a manifest that pointed at the deleted zone so later commands don't resolve a ghost.
    const manifest = loadManifest<StorageZoneManifest>(STORAGE_MANIFEST);
    const unlinked = manifest.id === zone.Id;
    if (unlinked) removeManifest(STORAGE_MANIFEST);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { id: zone.Id, name: zone.Name, removed: true },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Deleted storage zone ${zone.Name}.`);
    if (unlinked) logger.dim(`Removed stale .bunny/${STORAGE_MANIFEST}.`);
  },
});
