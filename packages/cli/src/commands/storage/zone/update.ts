import {
  replicationChoices,
  type StorageZoneModel,
  storageZonesUpdate,
} from "@bunny.net/actions";
import prompts from "prompts";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { isInteractive } from "../../../core/ui.ts";
import { confirmAddedReplicationRegions } from "../constants.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

interface ZoneUpdateArgs {
  zone?: string;
  custom404Path?: string;
  rewrite404To200?: boolean;
  replication?: string[];
  force?: boolean;
}

/** The settings half of the action input, gathered from flags or prompts. */
interface ZoneSettings {
  custom404FilePath?: string | null;
  rewrite404To200?: boolean;
  replicationRegions?: string[];
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

function settingsFromFlags(args: ZoneUpdateArgs): ZoneSettings {
  const settings: ZoneSettings = {};
  // An empty value clears the custom 404, matching the prompt's blank-for-none behavior.
  if (args.custom404Path !== undefined)
    settings.custom404FilePath = args.custom404Path || null;
  if (args.rewrite404To200 !== undefined)
    settings.rewrite404To200 = args.rewrite404To200;
  if (args.replication !== undefined)
    settings.replicationRegions = args.replication;
  return settings;
}

async function promptSettings(zone: StorageZoneModel): Promise<ZoneSettings> {
  const existing = (zone.ReplicationRegions ?? []).map((r) => r.toUpperCase());
  if (existing.length)
    logger.dim(`Already replicated (permanent): ${existing.join(", ")}`);
  const addable = replicationChoices(zone.Region ?? undefined).filter(
    (region) => !existing.includes(region.code),
  );

  const questions: prompts.PromptObject[] = [
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

  // Omit replicationRegions when nothing new was picked so replication is left untouched.
  const newReplicas: string[] = answers.replication ?? [];
  return {
    custom404FilePath: answers.custom404Path || null,
    rewrite404To200: answers.rewrite404To200,
    replicationRegions: newReplicas.length
      ? [...existing, ...newReplicas]
      : undefined,
  };
}

export const storageZoneUpdateCommand = defineActionCommand({
  action: storageZonesUpdate,
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

  progress: "Updating storage zone...",

  prepare: async (args, ctx) => {
    const hasFlags = hasAnyFlag(args);

    // JSON output, non-TTY, and --force all stay non-interactive; settings must come from flags.
    const interactive = isInteractive(args.output) && !args.force;
    if (!hasFlags && !interactive) {
      throw new UserError("No changes requested.", FLAG_HINT);
    }

    const zone = await resolveStorageZoneInteractive(
      ctx.clients.core,
      args.zone,
      { output: args.output, force: args.force, offerLink: true },
    );

    // Flags take full precedence over the editor: a partial set of flags is a partial update.
    const settings = hasFlags
      ? settingsFromFlags(args)
      : await promptSettings(zone);

    const existing = (zone.ReplicationRegions ?? []).map((r) =>
      r.toUpperCase(),
    );
    const requested = settings.replicationRegions?.flatMap((region) =>
      region.split(",").map((code) => code.trim().toUpperCase()),
    );
    const added = requested?.filter((code) => !existing.includes(code)) ?? [];
    const omitted = requested
      ? existing.filter((code) => !requested.includes(code))
      : [];

    if (omitted.length) {
      logger.warn(
        `Replication regions can't be removed; ${omitted.join(", ")} stays replicated.`,
      );
    }

    return {
      input: { zone: String(zone.Id), ...settings },
      // Only the replication additions are permanent, so only they need agreement.
      confirm: () =>
        confirmAddedReplicationRegions(added, { force: args.force }),
    };
  },

  render: (result) => {
    logger.success(`Updated storage zone ${result.zone.name}.`);
  },
});
