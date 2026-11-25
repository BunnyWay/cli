import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatKeyValue, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { streamLiveStats } from "@/tools/stream/index.ts";
import {
  LIVE_PREVIEW_EPILOGUE,
  parseTimeFlag,
  resolveLiveLibrary,
  withLibOption,
} from "./shared.ts";

function minutes(seconds: number): string {
  return `${(seconds / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} min`;
}

function sortedRows(values: Record<string, number>): string[][] {
  return Object.entries(values)
    .sort(([, a], [, b]) => b - a)
    .map(([key, seconds]) => [key, minutes(seconds)]);
}

export const streamLiveStatsCommand = defineToolCommand({
  tool: streamLiveStats,
  command: "stats",
  describe:
    "Show a library's live encoding minutes, split by primary and backup encoder, stream, codec and resolution.",
  examples: [
    ["$0 stream live stats", "The last 14 days for the linked library"],
    ["$0 stream live stats --from 2026-11-01 --to 2026-11-30", "A date range"],
    [
      "$0 stream live stats --stream 0f4e5d6c-... --hourly",
      "One stream, hourly",
    ],
  ],
  epilogue: `Live encoding is billed per minute by the highest output resolution, and primary and backup encoders are billed separately.\n\n${LIVE_PREVIEW_EPILOGUE}`,
  progress: "Fetching live statistics...",

  builder: (yargs) =>
    withLibOption(yargs)
      .option("from", {
        type: "string",
        describe: "Start date or time, ISO 8601 UTC (default: 14 days ago)",
      })
      .option("to", {
        type: "string",
        describe: "End date or time, ISO 8601 UTC (default: now)",
      })
      .option("hourly", {
        type: "boolean",
        default: false,
        describe: "Hourly buckets (within the last 30 days)",
      })
      .option("stream", {
        type: "string",
        array: true,
        describe: "Only these live stream IDs (repeatable, up to 50)",
      }),

  prepare: async (args, ctx) => {
    const from = args.from ? parseTimeFlag(args.from, "from") : undefined;
    const to = args.to ? parseTimeFlag(args.to, "to") : undefined;
    const library = await resolveLiveLibrary(ctx, args.lib, {
      output: args.output,
      offerLink: true,
    });
    const streams = args.stream
      ?.flatMap((s) => String(s).split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      input: {
        library: library.id,
        from,
        to,
        hourly: args.hourly,
        streams: streams?.length ? streams : undefined,
      },
    };
  },

  render: (stats, { output }) => {
    logger.log(
      formatKeyValue(
        [
          { key: "Total", value: minutes(stats.total.totalSeconds) },
          {
            key: "Primary encoders",
            value: minutes(stats.primary.totalSeconds),
          },
          { key: "Backup encoders", value: minutes(stats.backup.totalSeconds) },
        ],
        output,
      ),
    );
    for (const [title, header, values] of [
      ["By stream", "Live stream", stats.total.byStream],
      ["By resolution", "Resolution", stats.total.byResolution],
      ["By codec", "Codec", stats.total.byCodec],
    ] as const) {
      const rows = sortedRows(values);
      if (rows.length === 0) continue;
      logger.log();
      logger.log(`${title}:`);
      logger.log(formatTable([header, "Encoding"], rows, output));
    }
  },
});
