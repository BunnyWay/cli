import { stripAnsi } from "@bunny.net/stream-import";
import {
  requireSource,
  SOURCE_IDS,
  streamImportStatus,
} from "@bunny.net/tools/stream";
import type { Argv } from "yargs";
import { bunny } from "@/core/colors.ts";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatBytes, formatTable, formatTimeAgo } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { resolveLibraryInteractive } from "../interactive.ts";

interface StatusArgs {
  library?: string;
  source?: string;
}

export const streamImportStatusCommand = defineToolCommand({
  tool: streamImportStatus,
  command: "status",
  describe: "Show how far Bunny has got with a queued import.",
  progress: "Checking with Bunny...",
  examples: [
    [
      "$0 stream import status --library 12345 --source vimeo",
      "Progress of the Vimeo import into library 12345",
    ],
    ["$0 stream import status --output json", "The same, as JSON"],
  ],

  builder: (yargs) =>
    yargs
      .option("library", {
        alias: "lib",
        type: "string",
        describe:
          "Destination video library name or ID (defaults to the linked library)",
      })
      .option("source", {
        alias: "s",
        type: "string",
        choices: SOURCE_IDS,
        describe:
          "Source platform (defaults to the only one with a saved import)",
      }) as Argv<StatusArgs>,

  prepare: async (args, ctx) => {
    const library = await resolveLibraryInteractive(ctx, args.library, {
      output: args.output,
      offerLink: true,
    });

    return { input: { library: String(library.id), source: args.source } };
  },

  after: (result) => {
    if (result.failed > 0) process.exitCode = 1;
  },

  render: (result, { output }) => {
    const { library, videos } = result;
    const label = requireSource(result.source).label;
    logger.log(bunny.bold(`${label} to ${library.name}`));
    logger.log(
      formatTable(
        ["Video", "Bunny status", "Encoded", "Size", "Queued"],
        videos.map((r) => [
          stripAnsi(r.name),
          r.bunnyStatus,
          `${r.encodeProgress}%`,
          r.size ? formatBytes(r.size) : "",
          formatTimeAgo(r.queuedAt),
        ]),
        output,
      ),
    );
    logger.log("");
    logger.info(
      `${result.completed} finished, ${result.processing} processing, ${result.failed} failed.`,
    );
    if (result.stalled > 0) {
      logger.warn(
        `${result.stalled} videos have been processing with no data for over ${result.stalledAfterMinutes} minutes. If that persists, Bunny's fetch may have failed silently: delete them in the dashboard and re-run the import.`,
      );
    }
    const failed = videos.filter((r) => r.status === "failed");
    if (failed.length > 0) {
      for (const r of failed) logger.error(`${stripAnsi(r.name)}: ${r.error}`);
      logger.info(
        `Retry with ${bunny(`bunny stream import --library ${library.id} --source ${result.source} --resume`)}`,
      );
    }
  },
});
