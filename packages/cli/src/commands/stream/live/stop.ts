import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import { streamLiveGet, streamLiveStop } from "@/tools/stream/index.ts";
import {
  LIVE_PREVIEW_EPILOGUE,
  resolveLiveTarget,
  statusText,
  withStreamPositional,
} from "./shared.ts";

export const streamLiveStopCommand = defineToolCommand({
  tool: streamLiveStop,
  command: "stop [stream]",
  aliases: ["end"],
  describe:
    "End a live stream: the encoder is disconnected and the VOD, if on, is saved. Cannot be undone.",
  examples: [
    ["$0 stream live stop 0f4e5d6c-...", "End a live stream"],
    ["$0 stream live stop 0f4e5d6c-... --force", "Skip the confirmation"],
  ],
  epilogue: `Only a running stream can be stopped. To drop one that never went live, use \`bunny stream live delete\`.\n\n${LIVE_PREVIEW_EPILOGUE}`,
  progress: "Stopping live stream...",

  builder: (yargs) =>
    withStreamPositional(yargs).option("force", {
      alias: "f",
      type: "boolean",
      default: false,
      describe: "Skip the confirmation prompt",
    }),

  prepare: async (args, ctx) => {
    const { library, streamId } = await resolveLiveTarget(ctx, args, {
      eligible: (stream) => stream.status === "running",
      none: "No live streams are running.",
    });
    const input = { library: library.id, stream: streamId };
    const stream = await withSpinner("Fetching live stream...", () =>
      streamLiveGet.invoke(ctx, input),
    );
    if (stream.status !== "running") {
      throw new UserError(
        `${stream.title} is not live (${statusText(stream.status)}), so there is nothing to stop.`,
        stream.status === "preview" ||
          stream.status === "created" ||
          stream.status === "scheduled"
          ? "Start it with `bunny stream live start`, or remove it with `bunny stream live delete`."
          : undefined,
      );
    }

    requireConfirmable(args.output, {
      force: args.force,
      message: "Stopping a live stream needs a confirmation prompt.",
      hint: "Re-run with --force to stop it non-interactively.",
    });
    const recording =
      stream.type === "event" && stream.recordVod
        ? "The VOD is saved"
        : "No VOD is recorded";
    return {
      input,
      confirm: () =>
        confirm(
          `Stop ${stream.title}? The encoder is disconnected, viewers see the end of the stream, and it can't be restarted. ${recording}.`,
          { force: args.force },
        ),
    };
  },

  render: (stream) => {
    logger.success(`Stopped ${stream.title}.`);
    if (
      stream.status === "vodProcessing" ||
      (stream.type === "event" && stream.recordVod)
    ) {
      logger.dim(
        "The VOD is being processed; when ready, it plays from this stream's player and playback URL.",
      );
    }
  },
});
