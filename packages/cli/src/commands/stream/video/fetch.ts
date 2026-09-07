import { streamLibraryContext } from "@/commands/stream/context.ts";
import { queueVideoFetch } from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface FetchArgs {
  url: string;
  lib?: string;
  title?: string;
  collection?: string;
  thumbnailTime?: number;
  header?: string[];
}

/**
 * Turn repeated `--header "Name: value"` flags into the fetch request's header map.
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

/** Reject anything the Stream fetch endpoint cannot download. */
export function validateFetchUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\/\S/i.test(trimmed)) {
    throw new UserError(
      `Not an http(s) URL: ${url}`,
      "Pass a URL bunny.net can download, or use `bunny stream video upload <file>` for a local file.",
    );
  }
  return trimmed;
}

export const streamVideoFetchCommand = defineCommand<FetchArgs>({
  command: "fetch <url>",
  describe: "Have bunny.net fetch a video from a URL, server side.",
  examples: [
    [
      "$0 stream video fetch https://example.com/video.mp4",
      "Fetch into the linked library",
    ],
    [
      "$0 stream video fetch https://example.com/video.mp4 --lib 12345",
      "Fetch into a specific library",
    ],
    [
      '$0 stream video fetch https://example.com/video.mp4 --header "Authorization: Bearer abc"',
      "Send a header with the fetch",
    ],
    [
      '$0 stream video fetch https://example.com/video.mp4 --title "Launch demo"',
      "Set the video title",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "URL of the video for bunny.net to download",
        demandOption: true,
      })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("title", {
        type: "string",
        describe: "Video title (defaults to the remote file name)",
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
      })
      .option("header", {
        type: "string",
        array: true,
        describe: 'Header to send with the fetch as "Name: value" (repeatable)',
      }),

  handler: async ({
    url: rawUrl,
    lib,
    title,
    collection,
    thumbnailTime,
    header,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    // Validate the inputs before touching the network so a typo costs nothing.
    const url = validateFetchUrl(rawUrl);
    const headers = parseFetchHeaders(header);
    const wantedTitle = title?.trim() || undefined;
    const collectionId = collection?.trim() || undefined;

    const { client, library, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });

    // Queue-and-report: the response carries no video GUID, so there is no ID or
    // direct play URL to print until the video shows up in the library.
    const status = await withSpinner(`Queueing fetch of ${url}...`, () =>
      queueVideoFetch(
        client,
        libraryId,
        { url, title: wantedTitle, headers },
        { collectionId, thumbnailTime },
      ),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            queued: true,
            url,
            library: libraryId,
            title: wantedTitle,
            collectionId,
            thumbnailTime,
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
      "The video appears in `bunny stream video list` once bunny.net has fetched and encoded it.",
    );
  },
});
