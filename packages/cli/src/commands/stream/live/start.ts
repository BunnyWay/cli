import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import {
  isFinished,
  streamLiveStart,
  streamLiveStatus,
} from "@/tools/stream/index.ts";
import {
  LIVE_DOCS_EPILOGUE,
  resolveLiveTarget,
  statusText,
  streamRef,
  withStreamPositional,
} from "./shared.ts";

export const streamLiveStartCommand = defineToolCommand({
  tool: streamLiveStart,
  command: "start [stream]",
  aliases: ["go-live"],
  describe:
    "Take a live stream public: viewers can watch, and VOD recording starts if it's on.",
  examples: [
    ["$0 stream live start 0f4e5d6c-...", "Go live once the encoder publishes"],
    [
      "$0 stream live start 0f4e5d6c-... --force",
      "Start without asking, even when no encoder is publishing yet",
    ],
  ],
  epilogue: `Starting can't be undone: a live stream can't go back to Preview, only be stopped. It asks first; --force skips the question. Starting overrides a scheduled start. Nothing published before the start is recorded, so connect the encoder first and check it with \`bunny stream live status\`. Playback is ready 15-20 seconds after the start.\n\n${LIVE_DOCS_EPILOGUE}`,
  progress: "Starting live stream...",

  builder: (yargs) =>
    withStreamPositional(yargs).option("force", {
      alias: "f",
      type: "boolean",
      default: false,
      describe: "Start without asking, even with no encoder publishing",
    }),

  prepare: async (args, ctx) => {
    const { library, streamId } = await resolveLiveTarget(ctx, args, {
      eligible: (stream) => !isFinished(stream) && stream.status !== "running",
      none: "No live streams waiting to start.",
    });
    const input = { library: library.id, stream: streamId };
    const health = await withSpinner("Checking the encoder...", () =>
      streamLiveStatus.invoke(ctx, input),
    );

    if (health.status === "running") {
      throw new UserError(`${health.title} is already live.`);
    }
    if (isFinished(health)) {
      throw new UserError(
        `${health.title} has ended (${statusText(health.status)}) and can't be restarted.`,
        "Create a new live stream with `bunny stream live create`.",
      );
    }
    // Going live can't be undone, so every start asks; --force skips it.
    if (health.primaryLive || health.backupLive) {
      requireConfirmable(args.output, {
        force: args.force,
        message: "Starting a live stream needs a confirmation prompt.",
        hint: "Re-run with --force to start it non-interactively.",
      });
      return {
        input,
        confirm: () =>
          confirm(
            `Take ${health.title} public now? Viewers can watch it and VOD recording starts if it's on; it can't go back to Preview, only be stopped.`,
            { force: args.force },
          ),
      };
    }

    requireConfirmable(args.output, {
      force: args.force,
      message: "No encoder is publishing to this stream yet.",
      hint: "Connect the encoder first, or re-run with --force to start anyway.",
    });
    return {
      input,
      confirm: () =>
        confirm(
          `No encoder is publishing to ${health.title} yet, so viewers would see nothing and nothing is recorded until it connects. Start anyway? It can't go back to Preview, only be stopped.`,
          { force: args.force },
        ),
    };
  },

  render: (stream) => {
    logger.success(`${stream.title} is live.`);
    if (stream.recordVod && stream.type === "event")
      logger.dim("VOD: on. It is saved when you stop the stream.");
    if (stream.playbackUrl) logger.dim(`Playback (HLS): ${stream.playbackUrl}`);
    logger.dim("Playback is ready in 15-20 seconds.");
    logger.dim(
      `Stop it with: bunny stream live stop ${streamRef(stream.id, stream.libraryId)}`,
    );
  },
});
