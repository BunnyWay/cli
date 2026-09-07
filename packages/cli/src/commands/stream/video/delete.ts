import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import { deleteVideo } from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";

interface VideoDeleteArgs {
  video?: string;
  lib?: string;
  force?: boolean;
}

export const streamVideoDeleteCommand = defineCommand<VideoDeleteArgs>({
  command: "delete [video]",
  aliases: ["rm", "remove"],
  describe: "Delete a video from a Stream video library.",
  examples: [
    ["$0 stream video delete 1a2b3c4d-...", "Delete a video by GUID"],
    ["$0 stream video delete 1a2b3c4d-... --force", "Skip confirmation"],
    ["$0 stream video delete", "Pick a video interactively"],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", {
        type: "string",
        describe: "Video GUID",
      })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompt",
      }),

  handler: async ({
    video: ref,
    lib,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    // Destructive, so it never offers to link the directory to the library, and
    // --force disables both pickers rather than silently deleting a picked video.
    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      force,
    });

    const video = await resolveVideoInteractive(client, libraryId, ref, {
      output,
      force,
    });

    requireConfirmable(output, {
      force,
      message: `Deleting "${video.title}" needs a confirmation prompt.`,
      hint: "Re-run with --force to delete non-interactively.",
    });
    const confirmed = await confirm(
      `Delete video ${video.title}? This cannot be undone.`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    await withSpinner("Deleting video...", () =>
      deleteVideo(client, libraryId, video.guid),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { id: video.guid, title: video.title, removed: true },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Deleted video ${video.title}.`);
  },
});
