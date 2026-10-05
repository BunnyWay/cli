import { stripAnsi } from "@bunny.net/stream-import";
import {
  type ImportListing,
  MAX_PLAN_LIMIT,
  SOURCE_IDS,
  streamImportList,
} from "@bunny.net/tools/stream";
import type { Argv } from "yargs";
import {
  cliImportError,
  withImportSource,
} from "@/commands/stream/import-setup.ts";
import { DONE, defineToolCommand } from "@/core/define-tool-command.ts";
import { formatBytes, formatDuration, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";

interface ListArgs {
  source?: string;
  folder?: string;
  videos?: boolean;
  bucket?: string;
  prefix?: string;
  requestTimeout?: number;
}

function renderListing(listing: ImportListing, output: OutputFormat): void {
  if (listing.videos) {
    logger.log(
      formatTable(
        ["ID", "Name", "Folder", "Duration", "Size"],
        listing.videos.map((v) => [
          v.sourceId,
          stripAnsi(v.name),
          stripAnsi(v.folder ?? ""),
          v.duration ? formatDuration(v.duration) : "",
          v.size ? formatBytes(v.size) : "",
        ]),
        output,
      ),
    );
    if (listing.truncated)
      logger.dim(`Showing the first ${listing.videos.length} videos.`);
    return;
  }
  if (!listing.supportsFolders) {
    logger.info("This source has no folders. Use --videos to list its videos.");
    return;
  }
  logger.log(
    formatTable(
      ["ID", "Name", "Videos"],
      listing.folders.map((f) => [
        f.id,
        stripAnsi(f.name),
        String(f.videoCount),
      ]),
      output,
    ),
  );
  if (listing.uncategorized > 0)
    logger.dim(`${listing.uncategorized} videos are not in a folder.`);
  logger.dim(
    `Import one folder with bunny stream import --source ${listing.source} --folder <id>`,
  );
}

export const streamImportListCommand = defineToolCommand({
  tool: streamImportList,
  command: "list",
  describe: "Browse a source's folders and videos before importing.",
  examples: [
    ["$0 stream import list --source vimeo", "Folders and their IDs"],
    [
      "$0 stream import list --source vimeo --videos",
      "Every video, with the folder it is in",
    ],
    [
      "$0 stream import list --source vimeo --folder 12345",
      "The videos in one folder",
    ],
  ],

  builder: (yargs) =>
    yargs
      .option("source", {
        alias: "s",
        type: "string",
        choices: SOURCE_IDS,
        describe: "Source platform",
      })
      .option("videos", {
        type: "boolean",
        describe: "List videos instead of folders",
      })
      .option("folder", {
        type: "string",
        describe: "List the videos in one source folder",
      })
      .option("bucket", { type: "string", describe: "S3 bucket override" })
      .option("prefix", { type: "string", describe: "S3 prefix override" })
      .option("request-timeout", {
        type: "number",
        describe: "Seconds before one HTTP request gives up (1-3600)",
      }) as Argv<ListArgs>,

  // The tool runs here, inside the credential flow, so saved credentials can be dropped or typed ones saved around the call.
  prepare: async (args, baseCtx) => {
    const { result } = await withImportSource(
      baseCtx,
      args,
      args.output,
      "Listing source content...",
      (ctx, plugin) =>
        streamImportList.invoke(ctx, {
          source: plugin.id,
          folder: args.folder,
          videos: args.videos,
          bucket: args.bucket,
          prefix: args.prefix,
          requestTimeout: args.requestTimeout,
          limit: MAX_PLAN_LIMIT,
        }),
    );
    if (args.output === "json") logger.log(JSON.stringify(result, null, 2));
    else renderListing(result, args.output);
    return DONE;
  },

  onError: cliImportError,

  render: (result, { output }) => renderListing(result, output),
});
