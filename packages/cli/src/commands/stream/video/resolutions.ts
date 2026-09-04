import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import {
  fetchVideoResolutions,
  type VideoResolutionsInfoModel,
} from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface ResolutionsArgs {
  video?: string;
  lib?: string;
}

/**
 * One table row per resolution the API mentions anywhere, marking where it exists.
 *
 * The endpoint reports several overlapping lists (configured for the library,
 * available on the video, present in the playlist, in storage, and as MP4), so a
 * per-resolution matrix is the readable shape.
 */
export function resolutionRows(info: VideoResolutionsInfoModel): string[][] {
  const playlist = new Set(
    (info.playlistResolutions ?? []).map((entry) => entry.resolution ?? ""),
  );
  const storage = new Set(
    (info.storageResolutions ?? []).map((entry) => entry.resolution ?? ""),
  );
  const mp4 = new Set(
    (info.mp4Resolutions ?? []).map((entry) => entry.resolution ?? ""),
  );
  const available = new Set(info.availableResolutions ?? []);
  const configured = new Set(info.configuredResolutions ?? []);

  const all = [
    ...new Set([...configured, ...available, ...playlist, ...storage, ...mp4]),
  ].filter(Boolean);
  // Numeric order (240p before 1080p), with anything unparseable last.
  all.sort(
    (a, b) => (Number.parseInt(a, 10) || 0) - (Number.parseInt(b, 10) || 0),
  );

  const mark = (present: boolean) => (present ? "yes" : "-");
  return all.map((resolution) => [
    resolution,
    mark(configured.has(resolution)),
    mark(available.has(resolution)),
    mark(playlist.has(resolution)),
    mark(storage.has(resolution)),
    mark(mp4.has(resolution)),
  ]);
}

export const streamVideoResolutionsCommand = defineCommand<ResolutionsArgs>({
  command: "resolutions [video]",
  describe: "Show which resolutions exist for a video.",
  examples: [
    [
      "$0 stream video resolutions 1a2b3c4d-...",
      "List the video's resolutions",
    ],
    ["$0 stream video resolutions", "Pick a video interactively"],
    [
      "$0 stream video resolutions 1a2b3c4d-... --output json",
      "JSON output (includes storage objects)",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", { type: "string", describe: "Video GUID" })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      }),

  handler: async ({ video: ref, lib, profile, output, verbose, apiKey }) => {
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
    const info = await withSpinner("Fetching resolutions...", () =>
      fetchVideoResolutions(client, libraryId, video.guid),
    );

    if (output === "json") {
      logger.log(JSON.stringify(info, null, 2));
      return;
    }

    const rows = resolutionRows(info);
    if (rows.length === 0) {
      logger.info("No resolutions found for this video.");
      return;
    }

    logger.log(
      formatTable(
        ["Resolution", "Configured", "Available", "Playlist", "Storage", "MP4"],
        rows,
        output,
      ),
    );
    logger.dim(
      `Original file kept: ${info.hasOriginal ? "yes" : "no"}. Configured means enabled on the library.`,
    );
  },
});
