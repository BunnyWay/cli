import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatDateTime, formatDuration, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { streamLiveList } from "@/tools/stream/index.ts";
import {
  LIVE_DOCS_EPILOGUE,
  resolveLiveLibrary,
  statusLabel,
  withLibOption,
} from "./shared.ts";

export const streamLiveListCommand = defineToolCommand({
  tool: streamLiveList,
  command: "list",
  aliases: ["ls"],
  describe: "List the live streams in a video library.",
  examples: [
    ["$0 stream live list", "Live streams in the linked library"],
    ["$0 stream live list --lib 12345", "A specific library"],
    ["$0 stream live list --search keynote", "Filter by title or ID"],
    ["$0 stream live list --sort planned", "Order by scheduled start"],
  ],
  epilogue: LIVE_DOCS_EPILOGUE,
  progress: "Fetching live streams...",

  builder: (yargs) =>
    withLibOption(yargs)
      .option("search", {
        type: "string",
        describe: "Only streams whose title or ID contains this text",
      })
      .option("collection", {
        type: "string",
        describe: "Only streams in this collection ID",
      })
      .option("sort", {
        choices: [
          "date",
          "title",
          "status",
          "started",
          "ended",
          "planned",
        ] as const,
        describe: "Sort order (default: date)",
      }),

  prepare: async (args, ctx) => {
    const library = await resolveLiveLibrary(ctx, args.lib, {
      output: args.output,
      offerLink: true,
    });
    return {
      input: {
        library: library.id,
        search: args.search?.trim() || undefined,
        collection: args.collection?.trim() || undefined,
        orderBy: args.sort,
      },
    };
  },

  render: (streams, { output }) => {
    if (streams.length === 0) {
      logger.info("No live streams found.");
      logger.dim("Create one with `bunny stream live create <title>`.");
      return;
    }
    logger.log(
      formatTable(
        ["ID", "Title", "Status", "Type", "Scheduled", "Started", "Duration"],
        streams.map((stream) => [
          stream.id,
          stream.title,
          statusLabel(stream.status),
          stream.type,
          stream.scheduledStart ? formatDateTime(stream.scheduledStart) : "-",
          stream.startedAt ? formatDateTime(stream.startedAt) : "-",
          formatDuration(stream.durationSeconds),
        ]),
        output,
      ),
    );
  },
});
