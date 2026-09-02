import { createCoreClient } from "@bunny.net/openapi-client";
import type promptsLib from "prompts";
import type {
  StorageZoneModel,
  StorageZoneSettingsModel,
} from "@/commands/storage/api.ts";
import {
  confirmAddedReplicationRegions,
  normalizeReplicationRegions,
  type RegionScope,
  replicationChoices,
  zoneTierChoice,
} from "@/commands/storage/constants.ts";
import { resolveStorageZoneInteractive } from "@/commands/storage/interactive.ts";
import { isS3Enabled } from "@/commands/storage/s3.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, spinner } from "@/core/ui.ts";

interface ZoneUpdateArgs {
  zone?: string;
  custom404Path?: string;
  rewrite404To200?: boolean;
  replication?: string[];
  force?: boolean;
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

function zoneScope(zone: StorageZoneModel): RegionScope {
  return { tier: zoneTierChoice(zone), s3: isS3Enabled(zone) };
}

function settingsFromFlags(
  args: ZoneUpdateArgs,
  zone: StorageZoneModel,
): StorageZoneSettingsModel {
  const primaryCode = zone.Region ?? undefined;
  const settings: StorageZoneSettingsModel = {};
  // An empty value clears the custom 404, matching the prompt's blank-for-none behavior.
  if (args.custom404Path !== undefined)
    settings.Custom404FilePath = args.custom404Path || null;
  if (args.rewrite404To200 !== undefined)
    settings.Rewrite404To200 = args.rewrite404To200;
  if (args.replication !== undefined)
    settings.ReplicationZones = normalizeReplicationRegions(
      args.replication,
      primaryCode,
      zoneScope(zone),
      zone.ReplicationRegions ?? [],
    );
  return settings;
}

async function promptSettings(
  zone: StorageZoneModel,
): Promise<StorageZoneSettingsModel> {
  const existing = (zone.ReplicationRegions ?? []).map((r) => r.toUpperCase());
  if (existing.length)
    logger.dim(`Already replicated (permanent): ${existing.join(", ")}`);
  const addable = replicationChoices(
    zone.Region ?? undefined,
    zoneScope(zone),
  ).filter((region) => !existing.includes(region.code));

  const questions: promptsLib.PromptObject[] = [
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
  ];
  if (addable.length)
    questions.push({
      type: "multiselect",
      name: "replication",
      message:
        "Add replication regions (permanent once added; space to toggle):",
      choices: addable.map((region) => ({
        title: `${region.name} (${region.code})`,
        value: region.code,
      })),
    });

  // Abort the whole edit on cancel so a mid-flow Ctrl+C never applies partial answers.
  let cancelled = false;
  const answers = await prompts(questions, {
    onCancel: () => {
      cancelled = true;
      return false;
    },
  });
  if (cancelled) throw new UserError("Update cancelled.");

  // Omit ReplicationZones when nothing new was picked so the PATCH body leaves replication untouched.
  const newReplicas: string[] = answers.replication ?? [];
  return {
    Custom404FilePath: answers.custom404Path || null,
    Rewrite404To200: answers.rewrite404To200,
    ReplicationZones: newReplicas.length
      ? [...existing, ...newReplicas]
      : undefined,
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
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip prompts and confirmations (use flag values only)",
      }),

  handler: async (args) => {
    const { zone: ref, profile, output, verbose, apiKey } = args;
    const hasFlags = hasAnyFlag(args);

    // JSON output, non-TTY, and --force all stay non-interactive; settings must come from flags.
    const interactive = isInteractive(output) && !args.force;
    if (!hasFlags && !interactive) {
      throw new UserError("No changes requested.", FLAG_HINT);
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      force: args.force,
      offerLink: true,
    });
    // Flags take full precedence over the editor: a partial set of flags is a partial update.
    const settings = hasFlags
      ? settingsFromFlags(args, zone)
      : await promptSettings(zone);

    if (settings.ReplicationZones) {
      const existing = (zone.ReplicationRegions ?? []).map((r) =>
        r.toUpperCase(),
      );
      const requested = settings.ReplicationZones.map((r) => r.toUpperCase());
      const added = requested.filter((r) => !existing.includes(r));
      const omitted = existing.filter((r) => !requested.includes(r));

      // Replicas can't be removed, so the final set is always the existing ones plus any new picks.
      settings.ReplicationZones = [...new Set([...existing, ...requested])];

      if (omitted.length)
        logger.warn(
          `Replication regions can't be removed; ${omitted.join(", ")} stays replicated.`,
        );
      if (
        !(await confirmAddedReplicationRegions(added, { force: args.force }))
      ) {
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
