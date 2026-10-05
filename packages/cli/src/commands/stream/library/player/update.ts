import type { ToolContext } from "@bunny.net/tools";
import {
  type PlayerChanges,
  streamPlayerGet,
  streamPlayerUpdate,
} from "@bunny.net/tools/stream";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import {
  type PlayerFlags,
  playerChangesFromFlags,
  withPlayerOptions,
} from "./flags.ts";
import { formatPlayerSettings } from "./render.ts";

const FLAG_HINT =
  "Pass at least one of --language, --font, --color, --caption-color, --caption-background, --caption-size, --controls/--no-controls, --speeds, --custom-html, --heatmap, --remember-position, --compact-controls, --legacy-player, --player-version, --captions-in-playlist.";

/** Prefilled editor for the settings most worth prompting for; unchanged answers are dropped. */
async function promptPlayerChanges(
  ctx: ToolContext,
  library: number,
): Promise<PlayerChanges> {
  const current = await withSpinner("Fetching player settings...", () =>
    streamPlayerGet.invoke(ctx, { library }),
  );
  let cancelled = false;
  const answers = await prompts(
    [
      {
        type: "text",
        name: "color",
        message: "Primary colour (hex):",
        initial: current.color ?? "#FF7755",
      },
      {
        type: "text",
        name: "language",
        message: "UI language (ISO 639-1):",
        initial: current.language ?? "en",
      },
      {
        type: "toggle",
        name: "heatmap",
        message: "Show the watch-time heatmap?",
        initial: current.heatmap,
        active: "yes",
        inactive: "no",
      },
      {
        type: "toggle",
        name: "rememberPosition",
        message: "Resume where the viewer left off?",
        initial: current.rememberPosition,
        active: "yes",
        inactive: "no",
      },
      {
        type: "toggle",
        name: "compactControls",
        message: "Compact controls?",
        initial: current.compactControls,
        active: "yes",
        inactive: "no",
      },
    ],
    {
      onCancel: () => {
        cancelled = true;
        return false;
      },
    },
  );
  if (cancelled) throw new UserError("Update cancelled.");

  const changes: PlayerChanges = {};
  if (answers.color && answers.color !== current.color)
    changes.color = answers.color;
  if (answers.language && answers.language !== current.language)
    changes.language = answers.language;
  for (const key of [
    "heatmap",
    "rememberPosition",
    "compactControls",
  ] as const) {
    if (answers[key] !== undefined && answers[key] !== current[key])
      changes[key] = answers[key];
  }
  return changes;
}

export const streamLibraryPlayerUpdateCommand = defineToolCommand({
  tool: streamPlayerUpdate,
  command: "update [library]",
  describe: "Update a video library's player settings.",
  examples: [
    [
      '$0 stream library player update my-library --color "#FF7755" --heatmap',
      "Brand the player and show the heatmap",
    ],
    [
      "$0 stream library player update my-library --speeds 0.5,1.0,1.15,2.0",
      "Set playback speeds, including a custom one",
    ],
    [
      "$0 stream library player update my-library --no-controls",
      "Turn every player control off",
    ],
    ["$0 stream library player update my-library", "Edit interactively"],
  ],
  progress: "Updating player settings...",

  builder: (yargs) =>
    withPlayerOptions(
      yargs.positional("library", {
        type: "string",
        describe: "Video library name or ID",
      }),
    ),

  prepare: async (args, ctx) => {
    const flags = args as typeof args & PlayerFlags;
    const fromFlags = playerChangesFromFlags(flags);
    const hasFlags = Object.keys(fromFlags).length > 0;
    if (!hasFlags && !isInteractive(args.output)) {
      throw new UserError("No changes requested.", FLAG_HINT);
    }

    const lib = await resolveLibraryRef(ctx, args.library, {
      output: args.output,
      offerLink: true,
    });
    const changes = hasFlags
      ? fromFlags
      : await promptPlayerChanges(ctx, lib.id);
    if (Object.keys(changes).length === 0) {
      throw new UserError("No changes requested.", FLAG_HINT);
    }
    return { input: { library: lib.id, changes } };
  },

  render: (player, { output }) => {
    logger.success(
      `Updated player settings for video library ${player.library}.`,
    );
    logger.log(formatPlayerSettings(player, output));
  },
});
