import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatDateTime, formatKeyValue, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { streamLiveBitrate } from "@/tools/stream/index.ts";
import {
  LIVE_DOCS_EPILOGUE,
  parseDuration,
  parseTimeFlag,
  resolveLiveTarget,
  withStreamPositional,
} from "./shared.ts";

type Sample = { time: string; kbps: number };

export function bitrateSummary(samples: Sample[]): string {
  if (samples.length === 0) return "No samples";
  // One pass, no spread: a long-running channel's history can exceed the call-argument limit.
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const { kbps } of samples) {
    sum += kbps;
    if (kbps < min) min = kbps;
    if (kbps > max) max = kbps;
  }
  const fmt = (v: number) => Math.round(v).toLocaleString();
  return `avg ${fmt(sum / samples.length)} · min ${fmt(min)} · max ${fmt(max)} kbps (${samples.length} samples)`;
}

export const streamLiveBitrateCommand = defineToolCommand({
  tool: streamLiveBitrate,
  command: "bitrate [stream]",
  describe:
    "Show a live stream's ingest bitrate history for the primary and backup encoders.",
  examples: [
    ["$0 stream live bitrate 0f4e5d6c-...", "The whole recorded history"],
    ["$0 stream live bitrate 0f4e5d6c-... --since 15m", "The last 15 minutes"],
    [
      "$0 stream live bitrate 0f4e5d6c-... --from 2026-12-01T18:00:00Z --to 2026-12-01T19:00:00Z",
      "A time range",
    ],
  ],
  epilogue: LIVE_DOCS_EPILOGUE,
  progress: "Fetching bitrate history...",

  builder: (yargs) =>
    withStreamPositional(yargs)
      .option("since", {
        type: "string",
        describe: "Only the last stretch, e.g. 15m or 2h (instead of --from)",
      })
      .option("from", {
        type: "string",
        describe: "Start of the range, ISO 8601 UTC",
      })
      .option("to", {
        type: "string",
        describe: "End of the range, ISO 8601 UTC",
      })
      .option("limit", {
        type: "number",
        default: 20,
        describe:
          "Recent samples to list per encoder (text output; 0 for the summary only)",
      }),

  preRun: async ({ limit }) => {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0))
      throw new UserError("--limit must be a whole number, 0 or more.");
  },

  prepare: async (args, ctx) => {
    if (args.since && args.from)
      throw new UserError("Pass either --since or --from, not both.");
    const from = args.since
      ? new Date(
          Date.now() - parseDuration(args.since, "since") * 1000,
        ).toISOString()
      : args.from
        ? parseTimeFlag(args.from, "from")
        : undefined;
    const to = args.to ? parseTimeFlag(args.to, "to") : undefined;
    const { library, streamId } = await resolveLiveTarget(ctx, args);
    return { input: { library: library.id, stream: streamId, from, to } };
  },

  render: (history, { output, limit }) => {
    logger.log(
      formatKeyValue(
        [
          { key: "Primary", value: bitrateSummary(history.primary) },
          { key: "Backup", value: bitrateSummary(history.backup) },
        ],
        output,
      ),
    );
    const count = limit ?? 20;
    // slice(-0) is slice(0), the whole history, so 0 needs its own case.
    const recent = (samples: Sample[]) =>
      count === 0 ? [] : samples.slice(-count);
    for (const [label, samples] of [
      ["Primary", history.primary],
      ["Backup", history.backup],
    ] as const) {
      if (recent(samples).length === 0) continue;
      logger.log();
      logger.log(`${label} encoder, latest ${recent(samples).length}:`);
      logger.log(
        formatTable(
          ["Time", "kbps"],
          recent(samples).map((s) => [
            formatDateTime(s.time),
            Math.round(s.kbps).toLocaleString(),
          ]),
          output,
        ),
      );
    }
  },
});
