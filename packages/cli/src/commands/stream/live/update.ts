import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { streamLiveUpdate } from "@/tools/stream/index.ts";
import {
  formatLiveStreamDetails,
  LIVE_PREVIEW_EPILOGUE,
  liveSettingsFromFlags,
  resolveLiveTarget,
  withLiveSettingsOptions,
  withStreamPositional,
} from "./shared.ts";

export const streamLiveUpdateCommand = defineToolCommand({
  tool: streamLiveUpdate,
  command: "update [stream]",
  aliases: ["set"],
  describe: "Change a live stream's settings. Only the flags you pass change.",
  examples: [
    ['$0 stream live update 0f4e5d6c-... --title "Keynote (day 2)"', "Rename"],
    [
      "$0 stream live update 0f4e5d6c-... --end +1h",
      "Stop it automatically in an hour",
    ],
    [
      "$0 stream live update 0f4e5d6c-... --start none",
      "Drop the scheduled start",
    ],
    [
      "$0 stream live update 0f4e5d6c-... --type channel --no-record",
      "Turn an event into a 24/7 channel",
    ],
    ["$0 stream live update 0f4e5d6c-... --restream none", "Stop restreaming"],
  ],
  epilogue: `While a stream is live only --title, --description and --end can change. --type changes only before the stream starts, with no encoder connected.\n\n${LIVE_PREVIEW_EPILOGUE}`,
  progress: "Updating live stream...",

  builder: (yargs) =>
    withLiveSettingsOptions(
      withStreamPositional(yargs).option("title", {
        type: "string",
        describe: "New title",
      }),
      "update",
    ),

  prepare: async (args, ctx) => {
    const settings = liveSettingsFromFlags(args, "update");
    const title = args.title?.trim();
    if (args.title !== undefined && !title)
      throw new UserError("--title can't be empty.");
    if (!title && Object.keys(settings).length === 0) {
      throw new UserError(
        "Nothing to change.",
        "Pass at least one setting, e.g. --title, --end or --record. See --help.",
      );
    }
    const { library, streamId } = await resolveLiveTarget(ctx, args);
    return {
      input: { library: library.id, stream: streamId, title, ...settings },
    };
  },

  render: (stream, { output }) => {
    logger.success(`Updated ${stream.title}.`);
    logger.log(formatLiveStreamDetails(stream, output));
  },
});
