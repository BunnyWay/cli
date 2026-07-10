import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import type { OutputFormat } from "../../core/types.ts";
import { isInteractive, spinner } from "../../core/ui.ts";
import {
  fetchStorageZones,
  resolveStorageZone,
  type StorageZoneModel,
} from "./api.ts";
import { STORAGE_MANIFEST, type StorageZoneManifest } from "./constants.ts";

interface LinkArgs {
  zone?: string;
}

export const storageLinkCommand = defineCommand<LinkArgs>({
  command: "link [zone]",
  describe: "Link the current directory to a storage zone.",
  examples: [
    ["$0 storage link", "Interactive selection"],
    ["$0 storage link my-zone", "Direct link by name or ID"],
  ],

  builder: (yargs) =>
    yargs.positional("zone", {
      type: "string",
      describe: "Storage zone name or ID",
    }),

  handler: async ({ zone: ref, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    if (ref) {
      const spin = spinner("Resolving storage zone...");
      spin.start();
      let zone: StorageZoneModel;
      try {
        zone = await resolveStorageZone(client, ref);
      } finally {
        spin.stop();
      }
      linkZone(zone, output);
      return;
    }

    // Without a TTY (or in JSON mode) there is no one to answer the picker.
    if (!isInteractive(output)) {
      throw new UserError(
        "A storage zone is required.",
        "Pass the zone name or ID.",
      );
    }

    const spin = spinner("Fetching storage zones...");
    spin.start();
    let zones: StorageZoneModel[];
    try {
      zones = await fetchStorageZones(client);
    } finally {
      spin.stop();
    }

    if (zones.length === 0) {
      throw new UserError(
        "No storage zones found.",
        'Create one with "bunny storage zones add <name>".',
      );
    }

    const { selected } = await prompts({
      type: "select",
      name: "selected",
      message: "Select a storage zone to link:",
      choices: zones.map((zone) => ({
        title: `${zone.Name ?? ""} (${zone.Id})`,
        value: zone,
      })),
    });

    if (!selected) {
      throw new UserError("Link cancelled.");
    }

    linkZone(selected, output);
  },
});

function linkZone(zone: StorageZoneModel, output: OutputFormat): void {
  saveManifest<StorageZoneManifest>(STORAGE_MANIFEST, {
    id: zone.Id ?? 0,
    name: zone.Name ?? undefined,
  });

  if (output === "json") {
    logger.log(JSON.stringify({ id: zone.Id, name: zone.Name }));
    return;
  }

  logger.success(`Linked to ${zone.Name} (${zone.Id}).`);
}
