import { PLAYER_DEFAULTS, streamPlayerUpdate } from "@bunny.net/tools/stream";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable } from "@/core/ui.ts";
import { resolveLibraryRef } from "../library-ref.ts";

export const streamLibraryPlayerResetCommand = defineToolCommand({
  tool: streamPlayerUpdate,
  command: "reset [library]",
  describe:
    "Reset a video library's player to the dashboard defaults (language, font, colours, captions, controls, speeds).",
  examples: [
    ["$0 stream library player reset my-library", "Reset after confirming"],
    [
      "$0 stream library player reset my-library --force",
      "Reset without asking",
    ],
  ],
  progress: "Resetting player settings...",

  builder: (yargs) =>
    yargs
      .positional("library", {
        type: "string",
        describe: "Video library name or ID",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip the confirmation prompt",
      }),

  prepare: async ({ library, output, force }, ctx) => {
    requireConfirmable(output, {
      force,
      message: "Resetting the player needs confirmation.",
      hint: "Pass --force to reset without a prompt.",
    });
    const lib = await resolveLibraryRef(ctx, library, { output, force });
    return {
      input: {
        library: lib.id,
        changes: {
          ...PLAYER_DEFAULTS,
          controls: [...PLAYER_DEFAULTS.controls],
        },
      },
      confirm: () =>
        confirm(
          `Reset the player for ${lib.name} to the default language, font, colours, captions, controls and speeds?`,
          { force },
        ),
    };
  },

  render: (player) => {
    logger.success(
      `Reset the player for video library ${player.library} to the defaults.`,
    );
    logger.dim(
      "Heatmap, resumable position, compact controls, captions in playlist, custom HTML and player version were left as they are.",
    );
  },
});
