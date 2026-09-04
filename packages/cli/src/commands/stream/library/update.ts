import { createCoreClient } from "@bunny.net/openapi-client";
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
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import {
  hasLibrarySettingsFlags,
  type LibrarySettings,
  type LibrarySettingsArgs,
  librarySettingsFromFlags,
  RESOLUTION_CHOICES,
  withLibrarySettingsOptions,
} from "./flags.ts";

interface LibraryUpdateArgs extends LibrarySettingsArgs {
  library?: string;
  force?: boolean;
}

const FLAG_HINT =
  "Pass at least one of --name, --encoding-tier, --jit/--no-jit, --codecs, --resolutions, --transcribing/--no-transcribing, --transcribing-languages, --transcribing-title, --transcribing-description, --transcribing-chapters, --transcribing-moments.";

function hasAnyFlag(args: LibraryUpdateArgs): boolean {
  return args.name !== undefined || hasLibrarySettingsFlags(args);
}

/**
 * Interactive editor for the handful of settings worth prompting for.
 *
 * Prefilled from the library's current values, so accepting every answer is a
 * no-op edit rather than a rewrite.
 */
async function promptSettings(
  library: VideoLibraryModel,
): Promise<LibrarySettings> {
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

  const settings: LibrarySettings = {};
  const name = (answers.name as string | undefined)?.trim();
  if (name && name !== library.Name) settings.Name = name;
  // At least one resolution must stay enabled, so an empty pick is left alone.
  const resolutions: string[] = answers.resolutions ?? [];
  if (resolutions.length > 0)
    settings.EnabledResolutions = resolutions.join(",");
  if (answers.transcribing !== undefined)
    settings.EnableTranscribing = answers.transcribing;
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
    const fromFlags = hasFlags ? librarySettingsFromFlags(args) : undefined;

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const lib = await resolveLibraryInteractive(client, ref, {
      output,
      force: args.force,
      offerLink: true,
    });

    // Flags take full precedence over the editor: a partial set of flags is a partial update.
    const settings: VideoLibraryUpdateModel =
      fromFlags ?? (await promptSettings(lib));

    if (Object.keys(settings).length === 0) {
      logger.log("No changes requested.");
      return;
    }

    const updated = await withSpinner("Updating video library...", async () => {
      const { data } = await client.POST("/videolibrary/{id}", {
        params: { path: { id: lib.Id as number } },
        body: settings,
      });
      return data;
    });

    if (output === "json") {
      logger.log(
        JSON.stringify(
          updated ? toSafeVideoLibrary(updated) : { Id: lib.Id, ...settings },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Updated video library ${updated?.Name ?? lib.Name}.`);
    logger.dim(`Changed: ${Object.keys(settings).join(", ")}.`);
  },
});
