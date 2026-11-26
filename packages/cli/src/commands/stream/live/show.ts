import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { streamLiveGet } from "@/tools/stream/index.ts";
import {
  formatIssues,
  formatLiveStreamDetails,
  LIVE_PREVIEW_EPILOGUE,
  resolveLiveTarget,
  streamRef,
  withStreamPositional,
} from "./shared.ts";

export const streamLiveShowCommand = defineToolCommand({
  tool: streamLiveGet,
  command: "show [stream]",
  aliases: ["get"],
  describe: "Show a live stream's settings, status and issues.",
  examples: [
    ["$0 stream live show 0f4e5d6c-...", "Show one live stream"],
    ["$0 stream live show", "Pick a live stream interactively"],
    ["$0 stream live show 0f4e5d6c-... --output json", "JSON output"],
  ],
  epilogue: LIVE_PREVIEW_EPILOGUE,
  progress: "Fetching live stream...",

  builder: (yargs) => withStreamPositional(yargs),

  prepare: async (args, ctx) => {
    const { library, streamId } = await resolveLiveTarget(ctx, args, {
      offerLink: true,
    });
    return { input: { library: library.id, stream: streamId } };
  },

  render: (stream, { output }) => {
    logger.log(formatLiveStreamDetails(stream, output));
    const issues = formatIssues(stream, output);
    if (issues) {
      logger.log();
      logger.warn(`${stream.issues.length} issue(s) reported:`);
      logger.log(issues);
    }
    const ref = streamRef(stream.id, stream.libraryId);
    logger.log();
    logger.dim(
      `Encoder settings: bunny stream live ingest ${ref}  ·  Health: bunny stream live status ${ref}`,
    );
  },
});
