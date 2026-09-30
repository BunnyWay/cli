import { stripAnsi } from "@bunny.net/stream-import";
import {
  requireSource,
  SavedImportError,
  SOURCE_IDS,
  streamImportStatus,
} from "@bunny.net/tools/stream";
import type { Argv } from "yargs";
import { bunny } from "@/core/colors.ts";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatBytes, formatTable, formatTimeAgo } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { cliImportError } from "../import-setup.ts";
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

  onError: (error) => {
    if (!(error instanceof SavedImportError)) return cliImportError(error);
    const hint =
      error.sources.length > 1
        ? `Pass --source <${error.sources.join("|")}> to pick one.`
        : `Start one with \`bunny stream import --library ${error.libraryId}${error.source ? ` --source ${error.source}` : ""}\`.`;
    return new UserError(error.message, hint);
  },

  after: (result) => {
    if (result.failed > 0) process.exitCode = 1;
  },

  render: (result, { output }) => {
    const { library, videos } = result;
    const label = requireSource(result.source).label;
    const decorated = output === "text" || output === "table";
    if (decorated) logger.log(bunny.bold(`${label} to ${library.name}`));
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
    if (decorated) logger.log("");
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
