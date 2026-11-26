import { resolveConfig } from "@/config/index.ts";
import { bunny } from "@/core/colors.ts";
import { defineCommand } from "@/core/define-command.ts";
import { errorMessage, UserError } from "@/core/errors.ts";
import { formatDateTime, formatDuration } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import { extendToolContext } from "@/tools/context.ts";
import {
  type LiveIngest,
  type LiveStream,
  streamLiveCreate,
  streamLiveIngest,
} from "@/tools/stream/index.ts";
import {
  ENCODER_TIPS,
  formatIngest,
  LIVE_PREVIEW_EPILOGUE,
  type LiveSettingsArgs,
  liveSettingsFromFlags,
  maskIngest,
  resolveLiveLibrary,
  restreamEnv,
  streamRef,
  withLibOption,
  withLiveSettingsOptions,
} from "./shared.ts";

interface LiveCreateArgs extends LiveSettingsArgs {
  title?: string;
  lib?: string;
  showSecret?: boolean;
}

/**
 * How a new stream goes live, for the create summary: at its scheduled start
 * (no `live start` needed), when the encoder connects (auto-start), or on
 * `live start`.
 */
export function startFact(
  stream: Pick<LiveStream, "scheduledStart" | "autoStart">,
): string {
  if (stream.scheduledStart)
    return `starts by itself at ${formatDateTime(stream.scheduledStart)}`;
  if (stream.autoStart) return "starts when the encoder connects";
  return "starts when you run `live start`";
}

/**
 * The steps from a new stream to going live, as the docs' quickstart walks them.
 * `id` is the stream reference from {@link streamRef}, so the steps work when
 * pasted as they are.
 */
export function nextSteps(
  stream: LiveStream,
  id: string = stream.id,
): string[] {
  const steps = [
    `Reveal the key:   bunny stream live ingest ${id} --show-secret`,
    "Set up encoder:   paste the server and stream key into OBS (Settings > Stream > Custom) or vMix",
    `Check health:     bunny stream live status ${id} --watch`,
  ];
  if (stream.autoStart) {
    steps.push(
      "Go live:          auto-start is on, so connecting the encoder takes it live",
    );
  } else if (stream.scheduledStart) {
    steps.push(`Watch privately:  bunny stream live preview ${id}`);
    steps.push(
      `Go live:          automatic at ${formatDateTime(stream.scheduledStart)}`,
    );
    steps.push(`Go live early:    bunny stream live start ${id}`);
  } else {
    steps.push(`Watch privately:  bunny stream live preview ${id}`);
    steps.push(`Go live:          bunny stream live start ${id}`);
  }
  steps.push(`End it:           bunny stream live stop ${id}`);
  return steps;
}

export const streamLiveCreateCommand = defineCommand<LiveCreateArgs>({
  command: "create [title]",
  aliases: ["add", "new"],
  describe:
    "Create a live stream and get the encoder settings to broadcast to it.",
  examples: [
    [
      '$0 stream live create "Launch keynote"',
      "Create an event in the linked library",
    ],
    ["$0 stream live create", "Interactive: prompts for the title and type"],
    [
      '$0 stream live create "Launch keynote" --record --dvr 1h --start +30m --countdown',
      "Recorded, 1-hour DVR, scheduled in 30 minutes with a countdown",
    ],
    [
      '$0 stream live create "24/7 radio" --type channel --auto-start',
      "A 24/7 channel that goes live whenever the encoder connects",
    ],
    [
      '$0 stream live create "Simulcast" --restream rtmps://a.rtmp.youtube.com/live2/<key>',
      "Also send it to YouTube",
    ],
    [
      '$0 stream live create "Launch keynote" --lib 12345 --output json --show-secret',
      "For scripts: JSON including the stream key",
    ],
  ],
  epilogue: `Settings you leave out use the library's live defaults. Events end after 12 hours, or 30 minutes after the encoder disconnects; channels run until stopped.\n\n${LIVE_PREVIEW_EPILOGUE}`,

  builder: (yargs) =>
    withLiveSettingsOptions(
      withLibOption(
        yargs.positional("title", {
          type: "string",
          describe: "Title of the live stream",
        }),
      ),
      "create",
    ).option("show-secret", {
      type: "boolean",
      default: false,
      describe: "Print the stream key in full",
    }),

  handler: async (args) => {
    const { profile, apiKey, verbose, output } = args;
    // Flags first, so a typo fails before any prompt or request.
    let settings = liveSettingsFromFlags(args, "create");
    const ctx = toolContext(resolveConfig(profile, apiKey, verbose), {
      verbose,
    });

    let title = args.title?.trim();
    if (!title && isInteractive(output)) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Live stream title:",
      });
      title = typeof value === "string" ? value.trim() : undefined;
    }
    if (!title) {
      throw new UserError(
        "A title is required.",
        'Pass it: bunny stream live create "Launch keynote"',
      );
    }

    if (settings.type === undefined && isInteractive(output)) {
      const { type } = await prompts({
        type: "select",
        name: "type",
        message: "Type:",
        choices: [
          {
            title: "Event",
            description: "Up to 12 hours, can be recorded as a video",
            value: "event" as const,
          },
          {
            title: "Channel (24/7)",
            description: "No time limit, survives disconnects, never recorded",
            value: "channel" as const,
          },
        ],
      });
      if (type === undefined) throw new UserError("Cancelled.");
      settings = liveSettingsFromFlags({ ...args, type }, "create");
    }

    const library = await resolveLiveLibrary(ctx, args.lib, {
      output,
      offerLink: true,
    });
    // Restream keys reach the tool through the environment, never as input.
    const createCtx = extendToolContext(ctx, {
      env: restreamEnv(args, "create"),
    });
    const stream = await withSpinner("Creating live stream...", () =>
      streamLiveCreate.invoke(createCtx, {
        library: library.id,
        title,
        ...settings,
      }),
    );
    // The stream exists from here on, and create isn't idempotent: a failed
    // ingest lookup is reported as a warning, never as a failed create.
    let ingest: LiveIngest | null = null;
    let ingestError: string | undefined;
    try {
      ingest = await withSpinner("Fetching ingest settings...", () =>
        streamLiveIngest.invoke(ctx, {
          library: library.id,
          stream: stream.id,
        }),
      );
    } catch (err) {
      ingestError = errorMessage(err);
    }
    const shownIngest =
      ingest && (args.showSecret ? ingest : maskIngest(ingest));
    const ref = streamRef(stream.id, library.id);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            ...stream,
            ingest: shownIngest,
            ...(ingestError ? { ingestError } : {}),
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(
      `Created live stream ${stream.title} (ID: ${stream.id}) in ${library.name}.`,
    );
    const facts = [
      stream.type === "channel" ? "Channel (24/7)" : "Event",
      stream.type === "channel"
        ? "not recorded"
        : stream.recordVod
          ? "recorded"
          : "not recorded",
      stream.dvr.enabled
        ? `DVR ${formatDuration(stream.dvr.windowSeconds)}`
        : "no DVR",
      startFact(stream),
    ];
    // startFact names the schedule, so auto-start and the countdown are listed separately.
    if (stream.scheduledStart) {
      if (stream.autoStart) facts.push("auto-start on");
      facts.push(stream.countdown ? "countdown on" : "no countdown");
    }
    logger.dim(facts.join(" · "));

    logger.log();
    if (shownIngest) {
      logger.log(bunny.bold("Encoder settings"));
      logger.log(formatIngest(shownIngest, output));
      if (args.showSecret) logger.warn("Treat the stream key like a password.");
      for (const tip of ENCODER_TIPS) logger.dim(tip);
    } else {
      logger.warn(
        `The stream was created, but its encoder settings couldn't be fetched: ${ingestError}`,
      );
      logger.dim(`Get them with: bunny stream live ingest ${ref}`);
    }

    logger.log();
    logger.log(bunny.bold("Next steps"));
    for (const step of nextSteps(stream, ref)) logger.dim(`  ${step}`);
  },
});
