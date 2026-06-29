import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import type { StorageZoneModel, StorageZoneSettingsModel } from "../api.ts";
import {
  confirmAddedReplicationRegions,
  normalizeReplicationRegions,
  replicationChoices,
} from "../constants.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

interface ZoneUpdateArgs {
  zone?: string;
  custom404Path?: string;
  rewrite404To200?: boolean;
  replication?: string[];
}

const FLAG_HINT =
  "Pass at least one of --custom-404-path, --rewrite-404-to-200, --replication.";

function hasAnyFlag(args: ZoneUpdateArgs): boolean {
  return (
    args.custom404Path !== undefined ||
    args.rewrite404To200 !== undefined ||
    args.replication !== undefined
  );
}

function settingsFromFlags(
  args: ZoneUpdateArgs,
  primaryCode?: string,
): StorageZoneSettingsModel {
  const settings: StorageZoneSettingsModel = {};
  if (args.custom404Path !== undefined)
    settings.Custom404FilePath = args.custom404Path;
  if (args.rewrite404To200 !== undefined)
    settings.Rewrite404To200 = args.rewrite404To200;
  if (args.replication !== undefined)
    settings.ReplicationZones = normalizeReplicationRegions(
      args.replication,
      primaryCode,
    );
  return settings;
}

async function promptSettings(
  zone: StorageZoneModel,
): Promise<StorageZoneSettingsModel> {
  const answers = await prompts([
    {
      type: "text",
      name: "custom404Path",
      message: "Custom 404 file path (blank for none):",
      initial: zone.Custom404FilePath ?? "",
    },
    {
      type: "toggle",
      name: "rewrite404To200",
      message: "Rewrite 404 to 200?",
      initial: zone.Rewrite404To200 ?? false,
      active: "yes",
      inactive: "no",
    },
    {
      type: "multiselect",
      name: "replication",
      message: "Replication regions (space to toggle):",
      choices: replicationChoices(zone.Region ?? undefined).map((region) => ({
        title: `${region.name} (${region.code})`,
        value: region.code,
        selected: (zone.ReplicationRegions ?? []).includes(region.code),
      })),
    },
  ]);
  if (Object.keys(answers).length === 0)
    throw new UserError("Update cancelled.");

  return {
    Custom404FilePath: answers.custom404Path || null,
    Rewrite404To200: answers.rewrite404To200,
    ReplicationZones: answers.replication ?? [],
  };
}

export const storageZoneUpdateCommand = defineCommand<ZoneUpdateArgs>({
  command: "update [zone]",
  describe: "Update a storage zone's settings.",
  examples: [
    ["$0 storage zones update my-zone", "Edit settings interactively"],
    [
      "$0 storage zones update my-zone --custom-404-path /404.html",
      "Set the custom 404 file non-interactively",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("zone", {
        type: "string",
        describe: "Storage zone name or ID",
      })
      .option("custom-404-path", {
        type: "string",
        describe: "Path to the file returned for missing files",
      })
      .option("rewrite-404-to-200", {
        type: "boolean",
        describe: "Rewrite 404 responses to 200 for extensionless URLs",
      })
      .option("replication", {
        type: "string",
        array: true,
        describe: "Replication region codes (comma-separated or repeated)",
      }),

  handler: async (args) => {
    const { zone: ref, profile, output, verbose, apiKey } = args;
    const hasFlags = hasAnyFlag(args);

    // JSON output stays non-interactive; settings must come from flags.
    if (!hasFlags && output === "json") {
      throw new UserError("Nothing to update.", FLAG_HINT);
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, output);
    const settings = hasFlags
      ? settingsFromFlags(args, zone.Region ?? undefined)
      : await promptSettings(zone);

    const interactive = output !== "json" && process.stdout.isTTY === true;
    if (interactive && settings.ReplicationZones) {
      const existing = new Set(
        (zone.ReplicationRegions ?? []).map((r) => r.toUpperCase()),
      );
      const added = settings.ReplicationZones.filter(
        (r) => !existing.has(r.toUpperCase()),
      );
      if (!(await confirmAddedReplicationRegions(added))) {
        logger.log("Cancelled.");
        return;
      }
    }

    const spin = spinner("Updating storage zone...");
    spin.start();
    try {
      await client.POST("/storagezone/{id}", {
        params: { path: { id: zone.Id as number } },
        body: settings,
      });
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(
        JSON.stringify({ id: zone.Id, name: zone.Name, settings }, null, 2),
      );
      return;
    }

    logger.success(`Updated storage zone ${zone.Name}.`);
  },
});
