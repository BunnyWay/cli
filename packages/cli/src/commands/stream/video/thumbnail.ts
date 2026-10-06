import { stat } from "node:fs/promises";
import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import { setVideoThumbnail } from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface ThumbnailArgs {
  video?: string;
  lib?: string;
  url?: string;
  file?: string;
}

/**
 * Which thumbnail source to use, or a UserError when the flags don't name exactly one.
 *
 * The endpoint takes either a URL it downloads or a raw image body, so the two
 * flags are mutually exclusive and one of them is required.
 */
export function thumbnailSource(
  url: string | undefined,
  file: string | undefined,
): { url: string } | { file: string } {
  const wantedUrl = url?.trim();
  const wantedFile = file?.trim();

  if (wantedUrl && wantedFile) {
    throw new UserError(
      "Pass either --url or --file, not both.",
      "The API takes one thumbnail source per call.",
    );
  }
  if (wantedUrl) {
    if (!/^https?:\/\/\S/i.test(wantedUrl)) {
      throw new UserError(`Not an http(s) URL: ${url}`);
    }
    return { url: wantedUrl };
  }
  if (wantedFile) return { file: wantedFile };

  throw new UserError(
    "A thumbnail is required.",
    "Pass --url <image-url> for bunny.net to download, or --file <image> to upload one.",
  );
}

export const streamVideoThumbnailCommand = defineCommand<ThumbnailArgs>({
  command: "thumbnail [video]",
  describe: "Set a video's thumbnail image.",
  examples: [
    [
      "$0 stream video thumbnail 1a2b3c4d-... --url https://example.com/thumb.jpg",
      "Have bunny.net download the image",
    ],
    [
      "$0 stream video thumbnail 1a2b3c4d-... --file ./thumb.jpg",
      "Upload a local image",
    ],
    [
      "$0 stream video thumbnail --file ./thumb.jpg",
      "Pick the video interactively",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", { type: "string", describe: "Video GUID" })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("url", {
        type: "string",
        describe: "URL of the thumbnail image for bunny.net to download",
      })
      .option("file", {
        type: "string",
        describe: "Path to a local thumbnail image to upload",
      }),

  handler: async ({
    video: ref,
    lib,
    url,
    file,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const source = thumbnailSource(url, file);
    if ("file" in source) {
      const entry = await stat(source.file).catch(() => null);
      if (!entry?.isFile()) {
        throw new UserError(`Thumbnail file not found: ${source.file}`);
      }
    }

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

    const status = await withSpinner("Setting thumbnail...", () =>
      setVideoThumbnail(client, libraryId, video.guid, source),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { id: video.guid, title: video.title, updated: true, ...status },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Set the thumbnail for ${video.title}.`);
    logger.dim(
      "It can take a moment to appear on the CDN. To pick a frame by time instead, pass --thumbnail-time to `video upload` or `video fetch` at ingest.",
    );
  },
});
