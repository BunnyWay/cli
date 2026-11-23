import { parseTimeFlag } from "@/commands/stream/live/shared.ts";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatKeyValue, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import {
  formatUsd,
  type LibraryUsage,
  PREMIUM_PRICE_SUMMARY,
  streamLibraryUsage,
} from "@/tools/stream/index.ts";
import { resolveLibraryRef } from "./library-ref.ts";

const minutes = (seconds: number) =>
  `${(seconds / 60).toLocaleString("en-US", { maximumFractionDigits: 1 })} min`;
const usd = formatUsd;

export function formatUsage(usage: LibraryUsage, output: OutputFormat): string {
  const rows: { key: string; value: string }[] = [];
  const range = `${usage.from ?? "14 days ago"} to ${usage.to ?? "now"}`;
  rows.push({ key: "Period", value: range });
  if (usage.encoding) {
    const { premium, free, estimatedCost } = usage.encoding;
    rows.push({
      key: "Premium encoding",
      value: `${minutes(premium.billableSeconds)} billable (${minutes(premium.outputSeconds)} encoded) ≈ ${usd(estimatedCost)}`,
    });
    rows.push({
      key: "Free encoding",
      value: `${minutes(free.outputSeconds)} encoded`,
    });
  }
  if (usage.transcribing) {
    rows.push({
      key: "Transcribing",
      value: `${minutes(usage.transcribing.seconds)} ≈ ${usd(usage.transcribing.estimatedCost)}`,
    });
  }
  if (usage.drm) {
    rows.push({
      key: "DRM licenses",
      value: usage.drm.licenses.toLocaleString("en-US"),
    });
  }
  if (usage.live) {
    rows.push({ key: "Live encoding", value: minutes(usage.live.seconds) });
  }
  for (const [section, why] of Object.entries(usage.unavailable))
    rows.push({ key: section, value: `unavailable (${why})` });
  let text = formatKeyValue(rows, output);

  const codecs = usage.encoding?.premium.byCodec ?? {};
  if (Object.keys(codecs).length > 0) {
    text += `\n\nPremium encoding by codec:\n${formatTable(
      ["Codec", "Billable", "Encoded"],
      Object.entries(codecs)
        .sort(([, a], [, b]) => b.billable - a.billable)
        .map(([codec, s]) => [codec, minutes(s.billable), minutes(s.output)]),
      output,
    )}`;
  }
  return text;
}

export const streamLibraryUsageCommand = defineToolCommand({
  tool: streamLibraryUsage,
  command: "usage [library]",
  aliases: ["billing"],
  describe:
    "Show a video library's billable usage: encoding, transcribing, DRM licenses and live encoding, with cost estimates.",
  examples: [
    ["$0 stream libraries usage my-library", "The last 14 days"],
    [
      "$0 stream libraries usage my-library --from 2026-11-01 --to 2026-11-30",
      "One month",
    ],
    ["$0 stream libraries usage my-library --output json", "JSON output"],
  ],
  epilogue: `Premium encoding is billed per minute and per output codec at the rate of the highest resolution: ${PREMIUM_PRICE_SUMMARY}. The API's billable seconds already count each codec and weight by resolution (x0.5 below 720p, x1 up to 1080p, x3 above), so the estimate is billable minutes x $0.05. Transcribing is estimated at $0.10 per minute. Estimates only; your invoice is authoritative. Encoding statistics start on 2026-06-15.`,
  progress: "Fetching usage...",
  builder: (yargs) =>
    yargs
      .positional("library", {
        type: "string",
        describe: "Video library name or ID",
      })
      .option("from", {
        type: "string",
        describe: "Start date or time, ISO 8601 UTC (default: 14 days ago)",
      })
      .option("to", {
        type: "string",
        describe: "End date or time, ISO 8601 UTC (default: now)",
      }),
  prepare: async (args, ctx) => {
    const from = args.from ? parseTimeFlag(args.from, "from") : undefined;
    const to = args.to ? parseTimeFlag(args.to, "to") : undefined;
    const lib = await resolveLibraryRef(ctx, args.library, {
      output: args.output,
      offerLink: true,
    });
    return { input: { library: lib.id, from, to } };
  },
  render: (usage, { output }) => {
    logger.log(formatUsage(usage, output));
    logger.dim("Estimates only; your invoice is authoritative.");
  },
});
