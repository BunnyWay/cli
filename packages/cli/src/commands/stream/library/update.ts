import { createCoreClient } from "@bunny.net/openapi-client";
import { streamLibrariesAddRegions } from "@bunny.net/tools/stream";
import type promptsLib from "prompts";
import {
  toSafeVideoLibrary,
  type VideoLibraryModel,
  type VideoLibraryUpdateModel,
} from "@/commands/stream/api.ts";
import { resolveLibraryInteractive } from "@/commands/stream/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import {
  hasLibrarySettingsFlags,
  type LibrarySettingsArgs,
  librarySettingsFromFlags,
  librarySettingsWarnings,
  parseCsvFlag,
  RESOLUTION_CHOICES,
  withLibrarySettingsOptions,
} from "./flags.ts";
import { checkTranscribingLanguages } from "./language-check.ts";

interface LibraryUpdateArgs extends LibrarySettingsArgs {
  library?: string;
  force?: boolean;
  contentTagging?: boolean;
  addReplicationRegions?: string[];
}

const FLAG_HINT =
  "Pass at least one of --name, --encoding-tier, --jit/--no-jit, --codecs, --resolutions, --mp4-fallback, --early-play, --keep-original, --multi-audio, --content-tagging, --transcribing/--no-transcribing, --transcribing-languages, --transcribing-title, --transcribing-description, --transcribing-chapters, --transcribing-moments, --add-replication-regions.";

function hasAnyFlag(args: LibraryUpdateArgs): boolean {
  return (
    args.name !== undefined ||
    args.contentTagging !== undefined ||
    args.addReplicationRegions !== undefined ||
    hasLibrarySettingsFlags(args)
  );
}

/**
 * Interactive editor for the handful of settings worth prompting for.
 *
 * Prefilled from the library's current values, so accepting every answer is a
 * no-op edit rather than a rewrite.
 */
async function promptSettings(
  library: VideoLibraryModel,
): Promise<VideoLibraryUpdateModel> {
  const current = (library.EnabledResolutions ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const questions: promptsLib.PromptObject[] = [
    {
      type: "text",
      name: "name",
      message: "Library name:",
      initial: library.Name ?? "",
    },
    {
      type: "multiselect",
      name: "resolutions",
      message: "Enabled resolutions (space to toggle):",
      choices: RESOLUTION_CHOICES.map((resolution) => ({
        title: resolution,
        value: resolution,
        selected: current.includes(resolution),
      })),
    },
    {
      type: "toggle",
      name: "keepOriginal",
      message: "Keep original files (needed for Early-Play and re-encoding)?",
      initial: library.KeepOriginalFiles ?? false,
      active: "yes",
      inactive: "no",
    },
    {
      type: "toggle",
      name: "mp4Fallback",
      message: "MP4 fallback for players without HLS (adds storage)?",
      initial: library.EnableMP4Fallback ?? false,
      active: "yes",
      inactive: "no",
    },
    {
      type: "toggle",
      name: "contentTagging",
      message: "Content tagging?",
      initial: library.EnableContentTagging ?? false,
      active: "yes",
      inactive: "no",
    },
    {
      type: "toggle",
      name: "transcribing",
      message: "Automatic transcribing (billed per use)?",
      initial: library.EnableTranscribing ?? false,
      active: "yes",
      inactive: "no",
    },
  ];

  // Abort the whole edit on cancel so a mid-flow Ctrl+C never applies partial answers.
  let cancelled = false;
  const answers = await prompts(questions, {
    onCancel: () => {
      cancelled = true;
      return false;
    },
  });
  if (cancelled) throw new UserError("Update cancelled.");

  const settings: VideoLibraryUpdateModel = {};
  const name = (answers.name as string | undefined)?.trim();
  if (name && name !== library.Name) settings.Name = name;
  // At least one resolution must stay enabled, so an empty pick is left alone.
  const resolutions: string[] = answers.resolutions ?? [];
  const resolutionsChanged =
    resolutions.length !== current.length ||
    resolutions.some((resolution) => !current.includes(resolution));
  if (resolutions.length > 0 && resolutionsChanged)
    settings.EnabledResolutions = resolutions.join(",");
  if (
    answers.transcribing !== undefined &&
    answers.transcribing !== (library.EnableTranscribing ?? false)
  )
    settings.EnableTranscribing = answers.transcribing;
  const toggles = [
    ["keepOriginal", "KeepOriginalFiles"],
    ["mp4Fallback", "EnableMP4Fallback"],
    ["contentTagging", "EnableContentTagging"],
  ] as const;
  for (const [answer, field] of toggles) {
    if (
      answers[answer] !== undefined &&
      answers[answer] !== (library[field] ?? false)
    )
      settings[field] = answers[answer];
  }
  return settings;
}

export const streamLibraryUpdateCommand = defineCommand<LibraryUpdateArgs>({
  command: "update [library]",
  describe: "Update a Stream video library's settings.",
  examples: [
    ["$0 stream library update my-library", "Edit settings interactively"],
    [
      "$0 stream library update my-library --resolutions 720p,1080p",
      "Set the enabled resolutions",
    ],
    [
      "$0 stream library update my-library --encoding-tier premium --codecs x264,vp9",
      "Move to premium encoding with extra codecs",
    ],
    [
      "$0 stream library update my-library --transcribing --transcribing-languages en,de",
      "Enable transcribing into two languages",
    ],
    [
      "$0 stream library update my-library --add-replication-regions SYD",
      "Also replicate to Sydney (regions can't be removed later)",
    ],
    [
      "$0 stream library update my-library --content-tagging",
      "Turn on content tagging",
    ],
  ],

  builder: (yargs) =>
    withLibrarySettingsOptions(
      yargs
        .positional("library", {
          type: "string",
          describe: "Video library name or ID",
        })
        .option("name", {
          type: "string",
          describe: "New library name",
        })
        .option("content-tagging", {
          type: "boolean",
          describe:
            "Auto-categorise uploads with machine learning (update only; not accepted at create time)",
        })
        .option("add-replication-regions", {
          type: "string",
          array: true,
          describe:
            "Add replication regions (comma-separated or repeated). Add-only: regions can't be removed later",
        }),
    ).option("force", {
      alias: "f",
      type: "boolean",
      default: false,
      describe: "Skip prompts (use flag values only)",
    }),

  handler: async (args) => {
    const { library: ref, profile, output, verbose, apiKey } = args;
    const hasFlags = hasAnyFlag(args);

    // JSON output, non-TTY, and --force all stay non-interactive; settings must come from flags.
    const interactive = isInteractive(output) && !args.force;
    if (!hasFlags && !interactive) {
      throw new UserError("No changes requested.", FLAG_HINT);
    }

    // Parse and validate the flags before any network call.
    const fromFlags: VideoLibraryUpdateModel | undefined = hasFlags
      ? librarySettingsFromFlags(args)
      : undefined;
    if (fromFlags && args.contentTagging !== undefined)
      fromFlags.EnableContentTagging = args.contentTagging;
    // Rejects contradictory flags before any network call; the warnings are printed later.
    if (hasFlags) librarySettingsWarnings(args);
    const addRegions = args.addReplicationRegions
      ?.flatMap((value) => parseCsvFlag(value))
      .filter(Boolean);
    if (args.addReplicationRegions !== undefined && !addRegions?.length) {
      throw new UserError(
        "--add-replication-regions needs at least one region code.",
        "For example: --add-replication-regions SYD.",
      );
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const lib = await resolveLibraryInteractive(client, ref, {
      output,
      force: args.force,
      offerLink: true,
    });

    // Checked against the library's current state, so Early-Play advice is accurate.
    const warnings = hasFlags
      ? librarySettingsWarnings(args, lib.KeepOriginalFiles ?? false)
      : [];

    // Flags take full precedence over the editor: a partial set of flags is a partial update.
    const settings: VideoLibraryUpdateModel =
      fromFlags ?? (await promptSettings(lib));
    await checkTranscribingLanguages(
      config,
      settings.TranscribingCaptionLanguages,
      verbose,
    );

    if (Object.keys(settings).length === 0 && !addRegions?.length) {
      logger.log("No changes requested.");
      return;
    }

    const updated =
      Object.keys(settings).length > 0
        ? await withSpinner("Updating video library...", async () => {
            const { data } = await client.POST("/videolibrary/{id}", {
              params: { path: { id: lib.Id as number } },
              body: settings,
            });
            return data;
          })
        : undefined;

    // Regions live on the library's storage zone, so they go through the stream tools.
    const regions = addRegions?.length
      ? await withSpinner("Adding replication regions...", () =>
          streamLibrariesAddRegions.invoke(toolContext(config, { verbose }), {
            library: lib.Id as number,
            regions: addRegions,
          }),
        )
      : undefined;

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            ...(updated
              ? toSafeVideoLibrary(updated)
              : { Id: lib.Id, ...settings }),
            ...(regions
              ? {
                  ReplicationRegions: regions.regions,
                  AddedRegions: regions.added,
                }
              : {}),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (Object.keys(settings).length > 0) {
      logger.success(`Updated video library ${updated?.Name ?? lib.Name}.`);
      logger.dim(`Changed: ${Object.keys(settings).join(", ")}.`);
    }
    if (regions) {
      if (regions.added.length > 0) {
        logger.success(
          `Added ${regions.added.join(", ")}; now replicated to ${regions.regions.join(", ")}.`,
        );
      } else {
        logger.log(
          `Already replicated to ${regions.regions.join(", ")}; nothing added.`,
        );
      }
    }
    for (const warning of warnings) logger.warn(warning);
  },
});
