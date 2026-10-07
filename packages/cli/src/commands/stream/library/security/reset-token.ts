import { streamSecurityResetToken } from "@bunny.net/tools/stream";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable } from "@/core/ui.ts";
import { resolveLibraryRef } from "../library-ref.ts";

export const streamLibrarySecurityResetTokenCommand = defineToolCommand({
  tool: streamSecurityResetToken,
  command: "reset-token [library]",
  describe:
    "Rotate a video library's CDN and embed view token key. Every signed URL issued with the old key stops working.",
  examples: [
    [
      "$0 stream library security reset-token my-library",
      "Rotate after confirming",
    ],
    [
      "$0 stream library security reset-token my-library --force",
      "Rotate without asking",
    ],
  ],
  progress: "Resetting the token key...",

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
      message: "Resetting the token key needs confirmation.",
      hint: "Pass --force to reset it without a prompt.",
    });
    const lib = await resolveLibraryRef(ctx, library, { output, force });
    return {
      input: { library: lib.id },
      confirm: () =>
        confirm(
          `Reset the token key for ${lib.name}? Signed URLs issued with the old key stop working.`,
          { force },
        ),
    };
  },

  render: ({ library }) => {
    logger.success(
      `Reset the token authentication key for video library ${library}.`,
    );
    logger.dim(
      "Run `bunny stream library security show --show-secret` to see the new key.",
    );
  },
});
