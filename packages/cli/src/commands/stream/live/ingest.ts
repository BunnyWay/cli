import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { streamLiveIngest } from "@/tools/stream/index.ts";
import {
  ENCODER_TIPS,
  formatIngest,
  LIVE_PREVIEW_EPILOGUE,
  maskIngest,
  resolveLiveLibrary,
  resolveLiveTarget,
  withStreamPositional,
} from "./shared.ts";

export const streamLiveIngestCommand = defineToolCommand({
  tool: streamLiveIngest,
  command: "ingest [stream]",
  aliases: ["encoder"],
  describe:
    "Show where an encoder (OBS, vMix, FFmpeg) publishes: RTMPS, RTMP and SRT servers and the stream key.",
  examples: [
    ["$0 stream live ingest 0f4e5d6c-...", "Servers, with the key masked"],
    [
      "$0 stream live ingest 0f4e5d6c-... --show-secret",
      "Reveal the stream key to paste into the encoder",
    ],
    [
      "$0 stream live ingest --auto-create --show-secret",
      "The library's auto-create ingest: publishing creates and starts a stream",
    ],
  ],
  epilogue: `The stream key is a publishing credential: anyone holding it can broadcast to this stream. Rotate it with \`bunny stream live rotate-key\`.\n\n${LIVE_PREVIEW_EPILOGUE}`,
  progress: "Fetching ingest settings...",

  builder: (yargs) =>
    withStreamPositional(yargs)
      .option("show-secret", {
        type: "boolean",
        default: false,
        describe: "Reveal the stream key (also in SRT URLs)",
      })
      .option("auto-create", {
        type: "boolean",
        default: false,
        describe:
          "The library's auto-create ingest instead of one stream's (needs the full library API key)",
      }),

  prepare: async (args, ctx) => {
    if (args["auto-create"]) {
      const library = await resolveLiveLibrary(ctx, args.lib, {
        output: args.output,
      });
      return { input: { library: library.id } };
    }
    const { library, streamId } = await resolveLiveTarget(ctx, args);
    return { input: { library: library.id, stream: streamId } };
  },

  json: (ingest, args) => (args["show-secret"] ? ingest : maskIngest(ingest)),

  render: (ingest, args) => {
    const showSecret = args["show-secret"];
    const { output } = args;
    logger.log(formatIngest(showSecret ? ingest : maskIngest(ingest), output));
    logger.log();
    if (!ingest.streamId) {
      logger.warn(
        "Anyone with the auto-create key can create and start live streams in this library.",
      );
    }
    if (showSecret) logger.warn("Treat the stream key like a password.");
    else logger.dim("Key masked. Pass --show-secret to reveal it.");
    for (const tip of ENCODER_TIPS) logger.dim(tip);
  },
});
