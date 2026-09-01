import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { isInteractive, prompts, withSpinner } from "../../../core/ui.ts";
import { fetchVideo, updateVideo } from "../videos-api.ts";
import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "./interactive.ts";

interface VideoUpdateArgs {
  video?: string;
  lib?: string;
  title?: string;
}

/**
 * The title to save, or undefined when the prompt was cancelled or left blank.
 *
 * `--title` wins; otherwise an interactive run is offered the current title to
 * edit, and an unattended run has nothing to change and says so.
 */
export async function nextVideoTitle(
  current: string,
  title: string | undefined,
  interactive: boolean,
): Promise<string | undefined> {
  const explicit = title?.trim();
  if (explicit) return explicit;

  if (!interactive) {
    throw new UserError(
      "Nothing to update.",
      "Pass --title to set a new title.",
    );
  }

  const { value } = await prompts({
    type: "text",
    name: "value",
    message: "Title:",
    initial: current,
  });
  // A blank answer is treated as "leave it alone", like a cancel.
  return (value as string | undefined)?.trim() || undefined;
}

export const streamVideoUpdateCommand = defineCommand<VideoUpdateArgs>({
  command: "update [video]",
  describe: "Update a video's title.",
  examples: [
    [
      '$0 stream videos update 1a2b3c4d-... --title "Launch demo"',
      "Rename a video",
    ],
    ["$0 stream videos update", "Pick a video, then edit its title"],
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
      .option("title", {
        type: "string",
        describe: "New video title (prompts if omitted)",
      }),

  handler: async ({
    video: ref,
    lib,
    title,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });

    const video = await resolveVideoInteractive(client, libraryId, ref, {
      output,
    });

    const wanted = await nextVideoTitle(
      video.title,
      title,
      isInteractive(output),
    );
    if (wanted === undefined) {
      logger.log("Cancelled.");
      return;
    }

    if (wanted === video.title) {
      if (output === "json") {
        logger.log(JSON.stringify(video, null, 2));
        return;
      }
      logger.log("Title unchanged.");
      return;
    }

    await withSpinner("Updating video...", () =>
      updateVideo(client, libraryId, video.guid, { title: wanted }),
    );
    const updated = await withSpinner("Reading video...", () =>
      fetchVideo(client, libraryId, video.guid),
    );

    if (output === "json") {
      logger.log(JSON.stringify(updated, null, 2));
      return;
    }

    logger.success(`Renamed ${video.title} to ${updated.title}.`);
  },
});
