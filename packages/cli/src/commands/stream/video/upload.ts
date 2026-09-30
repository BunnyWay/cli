import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { streamLibraryContext } from "@/commands/stream/context.ts";
import { tusUpload } from "@/commands/stream/tus-api.ts";
import {
  createVideo,
  deleteVideo,
  directPlayUrl,
  fetchVideo,
  libraryApiKey,
  type StreamClient,
  uploadVideoFile,
  videoStatusLabel,
} from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { errorMessage, UserError } from "@/core/errors.ts";
import { formatBytes, formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface UploadArgs {
  file: string;
  lib?: string;
  title?: string;
  collection?: string;
  thumbnailTime?: number;
}

/**
 * Files larger than this go through resumable (TUS) uploads.
 *
 * A single PUT of a multi-gigabyte file has to succeed in one attempt; past this
 * size the odds of that stop being good enough.
 */
export const TUS_THRESHOLD_BYTES = 2 * 1024 ** 3;

/** Which upload mechanism a file of this size uses. */
export function uploadStrategy(size: number): "put" | "tus" {
  return size > TUS_THRESHOLD_BYTES ? "tus" : "put";
}

/** The video title: `--title` when given, otherwise the file's name. */
export function videoTitle(file: string, title?: string): string {
  const trimmed = title?.trim();
  return trimmed || basename(file);
}

/**
 * Size of the file to upload, or a UserError explaining why it can't be sent.
 *
 * Checked before any API call so a typo never leaves an empty video behind.
 */
export async function uploadFileSize(file: string): Promise<number> {
  const entry = await stat(file).catch(() => null);
  if (!entry) throw new UserError(`File not found: ${file}`);
  if (entry.isDirectory()) {
    throw new UserError(
      `${file} is a directory, and upload takes a single video file.`,
      "Upload each video in turn.",
    );
  }
  if (!entry.isFile()) {
    throw new UserError(`${file} is not a regular file.`);
  }
  return entry.size;
}

/** Video statuses that mean no bytes ever landed, so the shell is safe to delete. */
const EMPTY_VIDEO_STATUSES = new Set([
  0, // Created
  6, // UploadFailed
]);

/**
 * Whether a video is still an empty shell and can be cleaned up.
 *
 * Exported for testing: this is the guard that decides whether a failed upload
 * deletes anything at all.
 */
export function isEmptyVideoShell(status: number | undefined): boolean {
  return status !== undefined && EMPTY_VIDEO_STATUSES.has(status);
}

/**
 * Clean up after a failed byte upload, but only when nothing was stored.
 *
 * A lost or failed response does not prove the server rejected the bytes, so the
 * video's own status decides: an untouched shell is deleted, and anything else
 * (including a status that cannot be read) is kept and reported. Deleting on
 * ambiguity would throw away a good upload.
 */
async function removeOrphanVideo(
  client: StreamClient,
  libraryId: number,
  videoId: string,
): Promise<void> {
  let status: number | undefined;
  try {
    status = (await fetchVideo(client, libraryId, videoId)).status;
  } catch (err) {
    logger.warn(
      `Upload failed, and the state of video ${videoId} could not be read (${errorMessage(err)}); leaving it in place.`,
    );
    logger.dim("Check it with `bunny stream video list`.");
    return;
  }

  if (!isEmptyVideoShell(status)) {
    logger.warn(
      `Upload reported a failure, but video ${videoId} is ${videoStatusLabel(status)}, so the upload may have succeeded; leaving it in place.`,
    );
    logger.dim("Check it with `bunny stream video list`.");
    return;
  }

  try {
    await deleteVideo(client, libraryId, videoId);
    logger.warn(`Upload failed; removed the empty video ${videoId}.`);
  } catch (err) {
    logger.warn(
      `Upload failed, and removing the empty video ${videoId} also failed: ${errorMessage(err)}`,
    );
  }
}

export const streamVideoUploadCommand = defineCommand<UploadArgs>({
  command: "upload <file>",
  describe: "Upload a local video file to a Stream video library.",
  examples: [
    ["$0 stream video upload ./video.mp4", "Upload to the linked library"],
    [
      "$0 stream video upload ./video.mp4 --lib 12345",
      "Upload to a specific library",
    ],
    [
      '$0 stream video upload ./video.mp4 --title "Launch demo"',
      "Set the video title",
    ],
    [
      "$0 stream video upload ./video.mp4 --collection 8a7b6c5d-...",
      "Upload into a collection",
    ],
    [
      "$0 stream video upload ./video.mp4 --thumbnail-time 5000",
      "Grab the thumbnail from 5s in",
    ],
    [
      "$0 stream video fetch https://example.com/video.mp4",
      "For a remote video, let bunny.net fetch it instead",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "Path to the local video file to upload",
        demandOption: true,
      })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("title", {
        type: "string",
        describe: "Video title (defaults to the file name)",
      })
      .option("collection", {
        type: "string",
        describe:
          "Collection ID to put the video in (see `bunny stream collection list`)",
      })
      .option("thumbnail-time", {
        type: "number",
        describe:
          "Video time in milliseconds to grab the main thumbnail from at ingest",
      }),

  handler: async ({
    file,
    lib,
    title,
    collection,
    thumbnailTime,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const size = await uploadFileSize(file);
    const resumable = uploadStrategy(size) === "tus";

    const { client, library, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });
    // Resumable uploads sign the request with the library key instead of sending
    // it as a header, so read it up front and fail the same way the client does.
    const streamKey = resumable ? libraryApiKey(library) : undefined;

    const wanted = videoTitle(file, title);
    const created = await withSpinner(`Creating video ${wanted}...`, () =>
      createVideo(client, libraryId, wanted, {
        collectionId: collection?.trim() || undefined,
        thumbnailTime,
      }),
    );

    try {
      await withSpinner(
        `Uploading ${basename(file)} (${formatBytes(size)})...`,
        async (spin) => {
          if (!resumable) {
            await uploadVideoFile(client, libraryId, created.guid, file);
            return;
          }
          spin.text = `Uploading ${basename(file)} (0 B/${formatBytes(size)}, 0%) resumably...`;
          await tusUpload({
            libraryId,
            apiKey: streamKey as string,
            videoId: created.guid,
            filePath: file,
            size,
            title: wanted,
            filetype: Bun.file(file).type || undefined,
            onProgress: (uploaded, total) => {
              const percent = Math.floor((uploaded / total) * 100);
              spin.text = `Uploading ${basename(file)} (${formatBytes(uploaded)}/${formatBytes(total)}, ${percent}%) resumably...`;
            },
          });
        },
      );
    } catch (err) {
      await removeOrphanVideo(client, libraryId, created.guid);
      throw err;
    }

    // The bytes are already stored, so a failed refresh must not report the upload
    // as failed; fall back to the freshly created video for the summary.
    const video = await withSpinner("Reading video status...", () =>
      fetchVideo(client, libraryId, created.guid),
    ).catch((err) => {
      logger.debug(
        `Could not refresh video ${created.guid}: ${errorMessage(err)}`,
        Boolean(verbose),
      );
      return created;
    });

    if (output === "json") {
      logger.log(JSON.stringify(video, null, 2));
      return;
    }

    logger.success(`Uploaded ${video.title} to ${library.Name}.`);
    logger.log(
      formatKeyValue(
        [
          { key: "Video ID", value: video.guid },
          { key: "Library", value: `${library.Name ?? ""} (${libraryId})` },
          { key: "Status", value: videoStatusLabel(video.status) },
          { key: "Direct play", value: directPlayUrl(libraryId, video.guid) },
          { key: "Size", value: formatBytes(size) },
        ],
        output,
      ),
    );
    logger.dim("Encoding continues in the background.");
  },
});
