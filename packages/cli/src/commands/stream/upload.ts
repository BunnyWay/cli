import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { errorMessage, UserError } from "../../core/errors.ts";
import { formatBytes, formatKeyValue } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { withSpinner } from "../../core/ui.ts";
import { resolveLibraryInteractive } from "./interactive.ts";
import {
  connectStreamLibrary,
  createVideo,
  deleteVideo,
  directPlayUrl,
  fetchVideo,
  queueVideoFetch,
  type StreamClient,
  uploadVideoFile,
  videoStatusLabel,
} from "./videos-api.ts";

interface UploadArgs {
  source: string;
  lib?: string;
  title?: string;
  header?: string[];
}

/** The video title: `--title` when given, otherwise the file's name. */
export function videoTitle(file: string, title?: string): string {
  const trimmed = title?.trim();
  return trimmed || basename(file);
}

/** Whether the positional is a URL for bunny.net to fetch rather than a local path. */
export function isUploadUrl(source: string): boolean {
  return /^https?:\/\//i.test(source.trim());
}

/**
 * Turn repeated `--header "Key: Value"` flags into the fetch request's header map.
 *
 * Returns undefined when none were passed, so the field stays out of the body.
 */
export function parseFetchHeaders(
  values: string[] | undefined,
): Record<string, string> | undefined {
  if (!values || values.length === 0) return undefined;

  const headers: Record<string, string> = {};
  for (const raw of values) {
    const separator = raw.indexOf(":");
    // A missing colon, or one at position 0, leaves no header name to send.
    if (separator <= 0) {
      throw new UserError(
        `Invalid --header "${raw}".`,
        'Use "Name: value", e.g. --header "Authorization: Bearer abc".',
      );
    }
    headers[raw.slice(0, separator).trim()] = raw.slice(separator + 1).trim();
  }
  return headers;
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
    logger.dim("Check it with `bunny stream videos list`.");
    return;
  }

  if (!isEmptyVideoShell(status)) {
    logger.warn(
      `Upload reported a failure, but video ${videoId} is ${videoStatusLabel(status)}, so the upload may have succeeded; leaving it in place.`,
    );
    logger.dim("Check it with `bunny stream videos list`.");
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

export const streamUploadCommand = defineCommand<UploadArgs>({
  command: "upload <source>",
  describe: "Upload a video file, or fetch one from a URL, into a library.",
  examples: [
    ["$0 stream upload ./video.mp4", "Upload to the linked library"],
    [
      "$0 stream upload ./video.mp4 --lib 12345",
      "Upload to a specific library",
    ],
    [
      '$0 stream upload ./video.mp4 --title "Launch demo"',
      "Set the video title",
    ],
    [
      "$0 stream upload https://example.com/video.mp4 --lib 12345",
      "Have bunny.net fetch the video server side",
    ],
    [
      '$0 stream upload https://example.com/video.mp4 --header "Authorization: Bearer abc"',
      "Send a header with the fetch",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("source", {
        type: "string",
        describe:
          "Path to a local video file, or a URL for bunny.net to fetch server side",
        demandOption: true,
      })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("title", {
        type: "string",
        describe:
          "Video title (defaults to the file name, or the remote file name for a URL)",
      })
      .option("header", {
        type: "string",
        array: true,
        describe:
          'Header to send with a URL fetch as "Name: value" (repeatable; URL uploads only)',
      }),

  handler: async ({
    source,
    lib: ref,
    title,
    header,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const fromUrl = isUploadUrl(source);
    const headers = parseFetchHeaders(header);
    if (headers && !fromUrl) {
      throw new UserError(
        "--header only applies to a URL upload.",
        "Drop --header, or pass a URL for bunny.net to fetch.",
      );
    }

    // A URL is fetched by bunny.net, so there is nothing local to measure.
    const size = fromUrl ? 0 : await uploadFileSize(source);

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const library = await resolveLibraryInteractive(client, ref, {
      output,
      offerLink: true,
    });
    const libraryId = library.Id as number;
    const streamClient = connectStreamLibrary(library, { config, verbose });

    if (fromUrl) {
      // Queue-and-report: the fetch response carries no video GUID, so there is
      // no ID or direct play URL to print until the video shows up in the library.
      const wantedTitle = title?.trim() || undefined;
      // Detection trims, so the API must get the trimmed URL too.
      const url = source.trim();
      const status = await withSpinner(`Queueing fetch of ${url}...`, () =>
        queueVideoFetch(streamClient, libraryId, {
          url,
          title: wantedTitle,
          headers,
        }),
      );

      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              queued: true,
              url,
              library: libraryId,
              title: wantedTitle,
              ...status,
            },
            null,
            2,
          ),
        );
        return;
      }

      logger.success(`Queued fetch of ${url} into ${library.Name}.`);
      logger.dim(
        "The video appears in `bunny stream videos list` once bunny.net has fetched and encoded it.",
      );
      return;
    }

    const wanted = videoTitle(source, title);
    const created = await withSpinner(`Creating video ${wanted}...`, () =>
      createVideo(streamClient, libraryId, wanted),
    );

    try {
      await withSpinner(
        `Uploading ${basename(source)} (${formatBytes(size)})...`,
        () => uploadVideoFile(streamClient, libraryId, created.guid, source),
      );
    } catch (err) {
      await removeOrphanVideo(streamClient, libraryId, created.guid);
      throw err;
    }

    // The bytes are already stored, so a failed refresh must not report the upload
    // as failed; fall back to the freshly created video for the summary.
    const video = await withSpinner("Reading video status...", () =>
      fetchVideo(streamClient, libraryId, created.guid),
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
