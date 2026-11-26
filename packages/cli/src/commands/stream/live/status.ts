import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatDuration, formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import type { OutputFormat } from "@/core/types.ts";
import { withSpinner } from "@/core/ui.ts";
import {
  isFinished,
  type LiveStatusReport,
  streamLiveStatus,
} from "@/tools/stream/index.ts";
import {
  LIVE_PREVIEW_EPILOGUE,
  parseDuration,
  resolveLiveTarget,
  statusLabel,
  withStreamPositional,
} from "./shared.ts";

interface LiveStatusArgs {
  stream?: string;
  lib?: string;
  watch?: boolean;
  interval?: string;
}

function yesNo(
  value: boolean,
  yes = "Publishing",
  no = "Not connected",
): string {
  return value ? yes : no;
}

/** What to do next, given the stream's state. */
export function statusHint(report: LiveStatusReport): string | undefined {
  if (
    report.status === "preview" ||
    (report.readyToStart && report.status !== "running")
  )
    return `Encoder connected. Go live with: bunny stream live start ${report.id}`;
  if (report.status === "created" || report.status === "scheduled")
    return `Waiting for the encoder. Settings: bunny stream live ingest ${report.id}`;
  if (report.status === "running" && report.disconnected)
    return "The encoder dropped: reconnect it to resume. An event ends after 30 minutes without an encoder.";
  return undefined;
}

export function formatStatus(
  report: LiveStatusReport,
  output: OutputFormat,
): string {
  return formatKeyValue(
    [
      { key: "Stream", value: `${report.title} (${report.id})` },
      { key: "Status", value: statusLabel(report.status) },
      { key: "Primary encoder", value: yesNo(report.primaryLive) },
      { key: "Backup encoder", value: yesNo(report.backupLive) },
      {
        key: "Bitrate",
        value:
          report.bitrateKbps != null
            ? `${Math.round(report.bitrateKbps).toLocaleString()} kbps`
            : "-",
      },
      { key: "Ready to start", value: report.readyToStart ? "Yes" : "No" },
      { key: "Duration", value: formatDuration(report.durationSeconds) },
      {
        key: "Last ping",
        value:
          report.lastPingMs != null
            ? `${(report.lastPingMs / 1000).toFixed(1)}s ago`
            : "-",
      },
    ],
    output,
  );
}

export const streamLiveStatusCommand = defineCommand<LiveStatusArgs>({
  command: "status [stream]",
  aliases: ["health"],
  describe:
    "Check a live stream's health: encoder connections, ingest bitrate and duration.",
  examples: [
    ["$0 stream live status 0f4e5d6c-...", "Check once"],
    [
      "$0 stream live status 0f4e5d6c-... --watch",
      "Refresh every 5 seconds until Ctrl-C",
    ],
    ["$0 stream live status 0f4e5d6c-... --output json", "JSON output"],
  ],
  epilogue: LIVE_PREVIEW_EPILOGUE,

  builder: (yargs) =>
    withStreamPositional(yargs)
      .option("watch", {
        alias: "w",
        type: "boolean",
        default: false,
        describe: "Keep refreshing until Ctrl-C (or until the stream ends)",
      })
      .option("interval", {
        type: "string",
        default: "5s",
        describe: "Refresh interval for --watch, e.g. 5s or 1m",
      }),

  preRun: async ({ watch, output, interval }) => {
    if (watch && output === "json")
      throw new UserError(
        "--watch can't be combined with --output json.",
        "Poll `bunny stream live status --output json` instead.",
      );
    if (watch && parseDuration(interval ?? "5s", "interval") < 2)
      throw new UserError("--interval must be at least 2s.");
  },

  handler: async (args) => {
    const { profile, apiKey, verbose, output } = args;
    const ctx = toolContext(resolveConfig(profile, apiKey, verbose), {
      verbose,
    });
    const { library, streamId } = await resolveLiveTarget(ctx, args);
    const input = { library: library.id, stream: streamId };

    const check = () =>
      withSpinner("Checking live stream...", () =>
        streamLiveStatus.invoke(ctx, input),
      );

    const report = await check();
    if (output === "json") {
      logger.log(JSON.stringify(report, null, 2));
      return;
    }
    if (!args.watch) {
      logger.log(formatStatus(report, output));
      const hint = statusHint(report);
      if (hint) logger.dim(hint);
      return;
    }

    const intervalMs = parseDuration(args.interval ?? "5s", "interval") * 1000;
    let current = report;
    for (;;) {
      if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
      logger.log(formatStatus(current, output));
      const hint = statusHint(current);
      if (hint) logger.dim(hint);
      if (isFinished(current)) {
        logger.dim("The stream has ended.");
        return;
      }
      logger.dim(`Refreshing every ${intervalMs / 1000}s. Ctrl-C to stop.`);
      await Bun.sleep(intervalMs);
      current = await streamLiveStatus.invoke(ctx, input);
    }
  },
});
