import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import {
  fetchVideoHeatmap,
  fetchVideoPlayData,
  fetchVideoStatistics,
  formatDuration,
  type VideoStatisticsModel,
  videoStatusLabel,
} from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatKeyValue, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { withSpinner } from "@/core/ui.ts";

interface StatsArgs {
  video?: string;
  lib?: string;
  heatmap?: boolean;
  playData?: boolean;
  from?: string;
  to?: string;
  hourly?: boolean;
}

/** Which of the three mutually exclusive views was requested. */
export function statsView(args: {
  heatmap?: boolean;
  playData?: boolean;
}): "stats" | "heatmap" | "play-data" {
  if (args.heatmap && args.playData) {
    throw new UserError(
      "Pass either --heatmap or --play-data, not both.",
      "They are separate views of the same video.",
    );
  }
  if (args.heatmap) return "heatmap";
  if (args.playData) return "play-data";
  return "stats";
}

// Charts arrive as { timestamp: value } maps; total them for the summary.
function total(chart: { [key: string]: number } | null | undefined): number {
  return Object.values(chart ?? {}).reduce((sum, value) => sum + value, 0);
}

function topCountries(
  counts: { [key: string]: number } | null | undefined,
  limit = 5,
): string[][] {
  return Object.entries(counts ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([country, value]) => [country, String(value)]);
}

function renderStats(stats: VideoStatisticsModel, output: OutputFormat) {
  logger.log(
    formatKeyValue(
      [
        { key: "Views", value: String(total(stats.viewsChart)) },
        {
          key: "Watch time",
          value: formatDuration(total(stats.watchTimeChart)),
        },
        {
          key: "Countries",
          value: String(Object.keys(stats.countryViewCounts ?? {}).length),
        },
      ],
      output,
    ),
  );

  const countries = topCountries(stats.countryViewCounts);
  if (countries.length > 0) {
    logger.log("");
    logger.log(formatTable(["Country", "Views"], countries, output));
  }
}

export const streamVideoStatsCommand = defineCommand<StatsArgs>({
  command: "stats [video]",
  describe:
    "Show view statistics, the watch heatmap, or play data for a video.",
  examples: [
    ["$0 stream video stats 1a2b3c4d-...", "Views and watch time"],
    [
      "$0 stream video stats 1a2b3c4d-... --from 2026-08-01 --to 2026-08-31",
      "Statistics for a date range",
    ],
    ["$0 stream video stats 1a2b3c4d-... --heatmap", "Watch heatmap instead"],
    [
      "$0 stream video stats 1a2b3c4d-... --play-data",
      "Player URLs and playback settings instead",
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
      .option("heatmap", {
        type: "boolean",
        describe: "Show the watch heatmap instead of the statistics",
      })
      .option("play-data", {
        type: "boolean",
        describe: "Show playback data instead of the statistics",
      })
      .option("from", {
        type: "string",
        describe: "Start of the range (UTC date-time); defaults to 30 days ago",
      })
      .option("to", {
        type: "string",
        describe: "End of the range (UTC date-time); defaults to now",
      })
      .option("hourly", {
        type: "boolean",
        describe: "Report hourly instead of daily buckets",
      }),

  handler: async (args) => {
    const { video: ref, lib, profile, output, verbose, apiKey } = args;
    const view = statsView(args);

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

    if (view === "heatmap") {
      const heatmap = await withSpinner("Fetching heatmap...", () =>
        fetchVideoHeatmap(client, libraryId, video.guid),
      );
      if (output === "json") {
        logger.log(JSON.stringify(heatmap, null, 2));
        return;
      }
      const points = Object.entries(heatmap.heatmap ?? {});
      if (points.length === 0) {
        logger.info("No heatmap data yet for this video.");
        return;
      }
      logger.log(
        formatTable(
          ["Segment", "Intensity"],
          points.map(([segment, value]) => [segment, String(value)]),
          output,
        ),
      );
      logger.dim("Intensity is relative: 100 is the most-watched segment.");
      return;
    }

    if (view === "play-data") {
      const play = await withSpinner("Fetching play data...", () =>
        fetchVideoPlayData(client, libraryId, video.guid),
      );
      if (output === "json") {
        logger.log(JSON.stringify(play, null, 2));
        return;
      }
      logger.log(
        formatKeyValue(
          [
            { key: "Library", value: play.libraryName ?? "—" },
            { key: "Playlist URL", value: play.videoPlaylistUrl ?? "—" },
            { key: "Fallback URL", value: play.fallbackUrl ?? "—" },
            { key: "Original URL", value: play.originalUrl ?? "—" },
            { key: "Thumbnail URL", value: play.thumbnailUrl ?? "—" },
            { key: "Preview URL", value: play.previewUrl ?? "—" },
            { key: "Captions path", value: play.captionsPath ?? "—" },
            {
              key: "Token auth",
              value: play.tokenAuthEnabled ? "Enabled" : "Disabled",
            },
            { key: "DRM", value: play.enableDRM ? "Enabled" : "Disabled" },
            {
              key: "Video status",
              value: videoStatusLabel(play.video?.status),
            },
          ],
          output,
        ),
      );
      return;
    }

    const stats = await withSpinner("Fetching statistics...", () =>
      fetchVideoStatistics(client, libraryId, {
        videoGuid: video.guid,
        dateFrom: args.from,
        dateTo: args.to,
        hourly: args.hourly,
      }),
    );

    if (output === "json") {
      logger.log(JSON.stringify(stats, null, 2));
      return;
    }

    logger.log(`${video.title} (${video.guid})`);
    renderStats(stats, output);
  },
});
