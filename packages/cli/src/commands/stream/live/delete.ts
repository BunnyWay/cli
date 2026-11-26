import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import {
  type LiveStatusReport,
  streamLiveDelete,
  streamLiveGet,
  streamLiveStatus,
} from "@/tools/stream/index.ts";
import {
  LIVE_DOCS_EPILOGUE,
  resolveLiveTarget,
  streamRef,
  withStreamPositional,
} from "./shared.ts";

/**
 * The API refuses to delete a stream while an encoder publishes to it, so say
 * what to do instead of confirming a delete that can't succeed.
 */
export function assertNoPublisher(health: LiveStatusReport, ref: string): void {
  if (!health.primaryLive && !health.backupLive) return;
  throw new UserError(
    `An encoder is still publishing to ${health.title}, so it can't be deleted yet.`,
    health.status === "running"
      ? `End it first with \`bunny stream live stop ${ref}\`, which disconnects the encoder, then delete it.`
      : "Stop the encoder (OBS, vMix, FFmpeg) publishing to it, then delete it.",
  );
}

export const streamLiveDeleteCommand = defineToolCommand({
  tool: streamLiveDelete,
  command: "delete [stream]",
  aliases: ["rm", "remove"],
  describe:
    "Delete a live stream, and its VOD if it has one. Cannot be undone.",
  examples: [
    ["$0 stream live delete 0f4e5d6c-...", "Delete a live stream"],
    ["$0 stream live delete 0f4e5d6c-... --force", "Skip the confirmation"],
  ],
  epilogue: LIVE_DOCS_EPILOGUE,
  progress: "Deleting live stream...",

  builder: (yargs) =>
    withStreamPositional(yargs).option("force", {
      alias: "f",
      type: "boolean",
      default: false,
      describe: "Skip the confirmation prompt",
    }),

  prepare: async (args, ctx) => {
    // --force disables the pickers too, so it can never delete a picked stream.
    const { library, streamId } = await resolveLiveTarget(ctx, args);
    requireConfirmable(args.output, {
      force: args.force,
      message: "Deleting a live stream needs a confirmation prompt.",
      hint: "Re-run with --force to delete non-interactively.",
    });
    const input = { library: library.id, stream: streamId };
    const health = await withSpinner("Checking the encoder...", () =>
      streamLiveStatus.invoke(ctx, input),
    );
    assertNoPublisher(health, streamRef(streamId, library.id));
    if (args.force)
      return { input, confirm: () => confirm("", { force: true }) };

    const stream = await withSpinner("Fetching live stream...", () =>
      streamLiveGet.invoke(ctx, { library: library.id, stream: streamId }),
    );
    if (stream.status === "running") {
      logger.warn(
        `${stream.title} is live now: deleting it cuts off every viewer.`,
      );
    }
    // The VOD lives on the stream (there's no separate library video), so it goes too.
    const hasVod =
      stream.type === "event" &&
      stream.recordVod &&
      (stream.status === "ended" || stream.status === "vodProcessing");
    return {
      input,
      confirm: () =>
        confirm(
          hasVod
            ? `Delete live stream ${stream.title} and its VOD? This cannot be undone.`
            : `Delete live stream ${stream.title}? This cannot be undone.`,
        ),
    };
  },

  render: (result) => {
    logger.success(`Deleted live stream ${result.id}.`);
  },
});
