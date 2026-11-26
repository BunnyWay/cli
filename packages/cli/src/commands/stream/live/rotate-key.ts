import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import {
  isFinished,
  streamLiveGet,
  streamLiveRotateKey,
} from "@/tools/stream/index.ts";
import {
  formatIngest,
  LIVE_PREVIEW_EPILOGUE,
  maskIngest,
  resolveLiveTarget,
  withStreamPositional,
} from "./shared.ts";

export const streamLiveRotateKeyCommand = defineToolCommand({
  tool: streamLiveRotateKey,
  command: "rotate-key [stream]",
  aliases: ["regenerate-key"],
  describe:
    "Replace a live stream's stream key. Encoders using the old key are disconnected.",
  examples: [
    ["$0 stream live rotate-key 0f4e5d6c-...", "Rotate, with a confirmation"],
    [
      "$0 stream live rotate-key 0f4e5d6c-... --force --show-secret",
      "Rotate without asking and print the new key",
    ],
  ],
  epilogue: `A running stream is not ended: publish with the new key within the reconnect window to carry on with the same stream, recording and DVR. The SRT URLs change too, since they carry the key, and every preview token signed with the old key (live preview --sign) stops working.\n\n${LIVE_PREVIEW_EPILOGUE}`,
  progress: "Regenerating the stream key...",

  builder: (yargs) =>
    withStreamPositional(yargs)
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip the confirmation prompt",
      })
      .option("show-secret", {
        type: "boolean",
        default: false,
        describe: "Print the new stream key",
      }),

  prepare: async (args, ctx) => {
    const { library, streamId } = await resolveLiveTarget(ctx, args, {
      eligible: (stream) => !isFinished(stream),
    });
    const input = { library: library.id, stream: streamId };
    const stream = await withSpinner("Fetching live stream...", () =>
      streamLiveGet.invoke(ctx, input),
    );
    if (isFinished(stream)) {
      throw new UserError(
        `${stream.title} has ended, so its key can't be rotated.`,
      );
    }
    requireConfirmable(args.output, {
      force: args.force,
      message: "Rotating a stream key needs a confirmation prompt.",
      hint: "Re-run with --force to rotate it non-interactively.",
    });
    const live = stream.status === "running" || stream.status === "preview";
    return {
      input,
      confirm: () =>
        confirm(
          live
            ? `Rotate the key for ${stream.title}? It is publishing now: the encoder is disconnected within seconds and must reconnect with the new key, and preview links signed with the old key stop working.`
            : `Rotate the key for ${stream.title}? Encoders set up with the old key, and preview links signed with it, stop working.`,
          { force: args.force },
        ),
    };
  },

  json: (ingest, args) => (args["show-secret"] ? ingest : maskIngest(ingest)),

  render: (ingest, args) => {
    const showSecret = args["show-secret"];
    const { output } = args;
    logger.success("Stream key rotated.");
    if (ingest.warning) logger.warn(ingest.warning);
    logger.log(formatIngest(showSecret ? ingest : maskIngest(ingest), output));
    if (showSecret) logger.warn("Treat the stream key like a password.");
    else
      logger.dim(
        `Key masked. Reveal it with: bunny stream live ingest ${ingest.streamId} --show-secret`,
      );
  },
});
