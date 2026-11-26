import chalk from "chalk";
import type { Argv } from "yargs";
import { resolveLibraryRef } from "@/commands/stream/library/library-ref.ts";
import { UserError } from "@/core/errors.ts";
import {
  formatDateTime,
  formatDuration,
  formatKeyValue,
  formatTable,
  maskSecret,
} from "@/core/format.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import type { ToolContext } from "@/tools/index.ts";
import {
  LIVE_STATUS_LABELS,
  type LibrarySummary,
  type LiveIngest,
  type LiveSettings,
  type LiveStatus,
  type LiveStream,
  MAX_DVR_WINDOW_SECONDS,
  STREAM_TYPES,
  type StreamType,
  streamLiveList,
} from "@/tools/stream/index.ts";

/** Live streaming is a closed preview: said once in every live command's help. */
export const LIVE_PREVIEW_EPILOGUE =
  "Stream Live is in closed preview: it works on video libraries created during the preview, and features and limits may change before general availability. Docs: https://bunny.net/docs/stream/live";

export interface LiveTargetArgs {
  stream?: string;
  lib?: string;
}

/** `--lib`, shared by every live command; the same flag the video commands take. */
export function withLibOption<T>(yargs: Argv<T>) {
  return yargs.option("lib", {
    alias: "library",
    type: "string",
    describe: "Video library name or ID (defaults to the linked library)",
  });
}

/** The optional `[stream]` positional: picked from a list when left out in a terminal. */
export function withStreamPositional<T>(yargs: Argv<T>) {
  return withLibOption(
    yargs.positional("stream", {
      type: "string",
      describe: "Live stream ID (omit to pick one)",
    }),
  );
}

export function resolveLiveLibrary(
  ctx: ToolContext,
  lib: string | undefined,
  opts: { output?: OutputFormat; force?: boolean; offerLink?: boolean },
): Promise<LibrarySummary> {
  return resolveLibraryRef(ctx, lib, opts);
}

/**
 * The library, then the stream: an explicit ID, else a picker over the
 * library's streams (filtered by `eligible`) when interactive, else an error.
 * Destructive commands pass `force` so it disables the picker.
 */
export async function resolveLiveTarget(
  ctx: ToolContext,
  args: LiveTargetArgs & { output?: OutputFormat; force?: boolean },
  opts: {
    /** Which streams the picker offers, e.g. only running ones for `stop`. */
    eligible?: (stream: LiveStream) => boolean;
    /** Shown when the picker has nothing to offer. */
    none?: string;
    offerLink?: boolean;
  } = {},
): Promise<{ library: LibrarySummary; streamId: string }> {
  const library = await resolveLiveLibrary(ctx, args.lib, {
    output: args.output,
    force: args.force,
    offerLink: opts.offerLink,
  });
  const ref = args.stream?.trim();
  if (ref) return { library, streamId: ref };

  if (args.force || !isInteractive(args.output)) {
    throw new UserError(
      "A live stream is required.",
      "Pass the live stream ID, which `bunny stream live list` prints.",
    );
  }

  const streams = (
    await withSpinner("Fetching live streams...", () =>
      streamLiveList.invoke(ctx, { library: library.id }),
    )
  ).filter(opts.eligible ?? (() => true));
  if (streams.length === 0) {
    throw new UserError(
      opts.none ?? `No live streams found in ${library.name}.`,
      "Create one with `bunny stream live create`.",
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Live stream:",
    choices: streams.map((stream) => ({
      title: `${stream.title} (${statusText(stream.status)})`,
      description: stream.id,
      value: stream.id,
    })),
  });
  if (id === undefined) throw new UserError("A live stream is required.");
  return { library, streamId: id };
}

/** Plain status label, for prompts and machine-ish tables. */
export function statusText(status: LiveStatus): string {
  return LIVE_STATUS_LABELS[status];
}

/** Coloured status label for human output. */
export function statusLabel(status: LiveStatus): string {
  const label = LIVE_STATUS_LABELS[status];
  switch (status) {
    case "running":
      return chalk.green(`● ${label}`);
    case "preview":
      return chalk.yellow(`◐ ${label}`);
    case "scheduled":
      return chalk.cyan(label);
    case "error":
      return chalk.red(label);
    case "ended":
    case "vodProcessing":
      return chalk.dim(label);
    default:
      return label;
  }
}

/**
 * A duration as seconds: a bare number is seconds; `s`, `m`, `h` and `d`
 * suffixes are accepted, so `90`, `30m` and `2h` all work.
 */
export function parseDuration(value: string | number, flag: string): number {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 0) return Math.round(value);
  } else {
    const match = /^\s*(\d+(?:\.\d+)?)\s*([smhd]?)\s*$/i.exec(value);
    if (match) {
      const unit = { "": 1, s: 1, m: 60, h: 3600, d: 86_400 }[
        (match[2] ?? "").toLowerCase() as "" | "s" | "m" | "h" | "d"
      ];
      return Math.round(Number(match[1]) * unit);
    }
  }
  throw new UserError(
    `Invalid --${flag} "${value}".`,
    "Pass seconds, or a number with s, m, h or d, e.g. 30m or 2h.",
  );
}

/**
 * A point in time from a flag: ISO 8601 (a date alone means midnight UTC), or
 * `+<duration>` relative to now (`+15m`, `+2h`). Returned as ISO 8601 UTC.
 */
export function parseTimeFlag(
  value: string,
  flag: string,
  now: number = Date.now(),
): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+"))
    return new Date(
      now + parseDuration(trimmed.slice(1), flag) * 1000,
    ).toISOString();
  const parsed = Date.parse(trimmed);
  if (!trimmed || Number.isNaN(parsed)) {
    throw new UserError(
      `Invalid --${flag} "${value}".`,
      "Use ISO 8601 (2026-12-01T18:00:00Z) or a time from now (+30m, +2h).",
    );
  }
  return new Date(parsed).toISOString();
}

/** `none` clears an optional value on update; anything else is the value itself. */
export function clearable(
  value: string | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.toLowerCase() === "none" ? null : trimmed;
}

/** A `--restream` value safe to echo: the last path segment, where the destination's key goes, masked. */
export function maskRestream(value: string): string {
  const trimmed = value.trim();
  const slash = trimmed.lastIndexOf("/");
  // No path at all: the whole value may be a pasted key.
  if (slash === -1) return "•••";
  if (slash === trimmed.length - 1) return trimmed;
  return `${trimmed.slice(0, slash + 1)}•••`;
}

/**
 * A restream destination from one `--restream` value: the full RTMP(S) URL an
 * encoder would publish to, with the destination's stream key as the last path
 * segment (`rtmps://a.rtmp.youtube.com/live2/abcd-1234`).
 */
export function parseRestream(value: string): {
  endpoint: string;
  streamKey: string;
} {
  const trimmed = value.trim();
  const match = /^(rtmps?:\/\/[^/\s]+(?:\/[^\s]*)?)\/([^/\s]+)$/i.exec(trimmed);
  if (!match?.[1] || !match[2]) {
    throw new UserError(
      `Invalid --restream "${maskRestream(value)}".`,
      "Pass the destination's full RTMP(S) URL ending in its stream key, e.g. rtmps://a.rtmp.youtube.com/live2/<key>.",
    );
  }
  return { endpoint: match[1], streamKey: match[2] };
}

/** `--restream` values as destinations: [] for "none" on update, undefined when the flag isn't passed. */
function restreamDestinations(
  args: Pick<LiveSettingsArgs, "restream">,
  mode: "create" | "update",
): Array<{ endpoint: string; streamKey: string }> | undefined {
  if (args.restream === undefined) return undefined;
  const values = args.restream
    .flatMap((v) => String(v).split(/\s+/))
    .filter(Boolean);
  if (
    mode === "update" &&
    values.length === 1 &&
    values[0]?.toLowerCase() === "none"
  )
    return [];
  if (values.length > 4)
    throw new UserError("--restream takes at most 4 destinations.");
  return values.map(parseRestream);
}

/** The environment variable that carries the stream key of the nth `--restream` destination to the tool. */
export function restreamKeyEnv(index: number): string {
  return `BUNNY_STREAM_RESTREAM_KEY_${index + 1}`;
}

/**
 * The `--restream` stream keys, keyed by the variables `liveSettingsFromFlags`
 * names in the tool input. Third-party keys never go in tool input; the command
 * layers this over the environment for the one invocation.
 */
export function restreamEnv(
  args: Pick<LiveSettingsArgs, "restream">,
  mode: "create" | "update",
): Record<string, string> {
  return Object.fromEntries(
    (restreamDestinations(args, mode) ?? []).map((d, i) => [
      restreamKeyEnv(i),
      d.streamKey,
    ]),
  );
}

/** Flags shared by `live create` and `live update`. */
export interface LiveSettingsArgs {
  description?: string;
  collection?: string;
  type?: string;
  record?: boolean;
  autoStart?: boolean;
  dvr?: string;
  start?: string;
  end?: string;
  countdown?: boolean;
  trailer?: string;
  restream?: string[];
}

export function withLiveSettingsOptions<T>(
  yargs: Argv<T>,
  mode: "create" | "update",
) {
  const clear = mode === "update" ? ' ("none" removes it)' : "";
  return yargs
    .option("description", {
      type: "string",
      describe: `Description${clear}`,
    })
    .option("collection", {
      type: "string",
      describe: `Collection ID to put the stream in${clear}`,
    })
    .option("type", {
      type: "string",
      choices: [...STREAM_TYPES],
      describe:
        mode === "create"
          ? "event (default): up to 12 hours, can be recorded; channel: 24/7, survives disconnects, never recorded"
          : "Change the type (only before the stream starts, with no encoder connected)",
    })
    .option("record", {
      type: "boolean",
      describe:
        "Save the stream as a video when it stops (--no-record turns it off; channels are never recorded)",
    })
    .option("auto-start", {
      type: "boolean",
      describe:
        "Go live as soon as an encoder connects, skipping preview (--no-auto-start to start it yourself)",
    })
    .option("dvr", {
      type: "string",
      describe: `DVR (rewind) window, e.g. 30m or 2h, up to 12h; 0 turns DVR off`,
    })
    .option("start", {
      type: "string",
      describe: `Scheduled start: ISO 8601 UTC or +30m from now${clear}`,
    })
    .option("end", {
      type: "string",
      describe: `Scheduled end, which stops the stream: ISO 8601 UTC or +2h from now${clear}`,
    })
    .option("countdown", {
      type: "boolean",
      describe: "Show a countdown in the player before a scheduled start",
    })
    .option("trailer", {
      type: "string",
      describe: `Video GUID to loop before the stream starts${clear}`,
    })
    .option("restream", {
      type: "string",
      array: true,
      describe: `Also send the stream to another platform: its full RTMP(S) URL ending in the stream key (repeatable, up to 4${mode === "update" ? '; replaces the current list, "none" removes all' : ""})`,
    });
}

/** Flags to tool settings. Validates everything before any request. */
export function liveSettingsFromFlags(
  args: LiveSettingsArgs,
  mode: "create" | "update",
  now: number = Date.now(),
): LiveSettings {
  const settings: LiveSettings = {};
  const optional = (value: string | undefined) =>
    mode === "update" ? clearable(value) : value?.trim() || undefined;

  const description = optional(args.description);
  if (description !== undefined) settings.description = description;
  const collection = optional(args.collection);
  if (collection !== undefined) settings.collectionId = collection;
  const trailer = optional(args.trailer);
  if (trailer !== undefined) settings.trailerVideoId = trailer;

  if (args.type !== undefined) settings.type = args.type as StreamType;
  if (args.record !== undefined) settings.recordVod = args.record;
  if (args.autoStart !== undefined) settings.autoStart = args.autoStart;
  if (args.countdown !== undefined) settings.countdown = args.countdown;

  if (args.dvr !== undefined) {
    const seconds = parseDuration(args.dvr, "dvr");
    if (seconds > MAX_DVR_WINDOW_SECONDS) {
      throw new UserError(
        `--dvr can be at most 12h (${MAX_DVR_WINDOW_SECONDS} seconds).`,
      );
    }
    settings.dvrWindowSeconds = seconds;
  }

  for (const [flag, key] of [
    ["start", "scheduledStart"],
    ["end", "scheduledEnd"],
  ] as const) {
    const raw = optional(args[flag]);
    if (raw === null) settings[key] = null;
    else if (raw !== undefined) settings[key] = parseTimeFlag(raw, flag, now);
  }
  for (const key of ["scheduledStart", "scheduledEnd"] as const) {
    const value = settings[key];
    if (value && Date.parse(value) <= now) {
      throw new UserError(
        `The scheduled ${key === "scheduledStart" ? "start" : "end"} must be in the future.`,
      );
    }
  }

  const destinations = restreamDestinations(args, mode);
  if (destinations !== undefined) {
    settings.outputs = destinations.map((d, i) => ({
      endpoint: d.endpoint,
      streamKeyEnv: restreamKeyEnv(i),
    }));
  }

  if (settings.type === "channel" && settings.recordVod === true) {
    throw new UserError(
      "A channel can't be recorded.",
      "Drop --record, or use --type event.",
    );
  }
  return settings;
}

function dash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === ""
    ? "-"
    : String(value);
}

/** Recording, as one phrase: "on", "off", or "never (channel)". */
function recordingText(stream: LiveStream): string {
  if (stream.type === "channel") return "Never (channel)";
  return stream.recordVod ? "On, saved as a video when it stops" : "Off";
}

export function formatLiveStreamDetails(
  stream: LiveStream,
  output: OutputFormat | undefined,
): string {
  const rows = [
    { key: "ID", value: stream.id },
    { key: "Title", value: stream.title },
    { key: "Status", value: statusLabel(stream.status) },
    {
      key: "Type",
      value: stream.type === "channel" ? "Channel (24/7)" : "Event",
    },
    { key: "Description", value: dash(stream.description) },
    { key: "Collection", value: dash(stream.collectionId) },
    { key: "Created", value: formatDateTime(stream.createdAt) },
    {
      key: "Scheduled start",
      value: stream.scheduledStart
        ? formatDateTime(stream.scheduledStart)
        : "-",
    },
    {
      key: "Scheduled end",
      value: stream.scheduledEnd ? formatDateTime(stream.scheduledEnd) : "-",
    },
    {
      key: "Started",
      value: stream.startedAt ? formatDateTime(stream.startedAt) : "-",
    },
    {
      key: "Ended",
      value: stream.endedAt ? formatDateTime(stream.endedAt) : "-",
    },
    { key: "Duration", value: formatDuration(stream.durationSeconds) },
    {
      key: "Auto-start",
      value: stream.autoStart ? "On encoder connect" : "Off",
    },
    { key: "Recording", value: recordingText(stream) },
    {
      key: "DVR",
      value: stream.dvr.enabled
        ? `${formatDuration(stream.dvr.windowSeconds)} window`
        : "Off",
    },
    { key: "Countdown", value: stream.countdown ? "On" : "Off" },
    { key: "Trailer video", value: dash(stream.trailerVideoId) },
    { key: "Playback (HLS)", value: dash(stream.playbackUrl) },
    { key: "Resolutions", value: stream.resolutions.join(", ") || "-" },
    {
      key: "Input",
      value: stream.input
        ? `${dash(stream.input.width)}x${dash(stream.input.height)} @ ${dash(stream.input.framerate)} fps`
        : "-",
    },
    { key: "Peak viewers", value: dash(stream.peakViewers) },
    {
      key: "Watch time",
      value:
        stream.totalViewerSeconds != null
          ? formatDuration(stream.totalViewerSeconds)
          : "-",
    },
    {
      key: "Restream to",
      value: stream.outputs.map((o) => o.endpoint).join("\n") || "-",
    },
  ];
  return formatKeyValue(rows, output ?? "text");
}

export function formatIssues(
  stream: LiveStream,
  output: OutputFormat | undefined,
): string | undefined {
  if (stream.issues.length === 0) return undefined;
  return formatTable(
    ["Time", "Level", "Issue", "Message"],
    stream.issues.map((issue) => [
      issue.time ? formatDateTime(issue.time) : "-",
      issue.level,
      issue.code,
      issue.message,
    ]),
    output ?? "text",
  );
}

/** Mask the key an SRT URL carries in `streamid=publish:live/<key>`. */
export function maskSrtUrl(url: string): string {
  return url.replace(
    /(streamid=publish:live\/)([^&]+)/i,
    (_, prefix: string, key: string) =>
      `${prefix}${maskSecret(decodeURIComponent(key))}`,
  );
}

/** The ingest settings with every credential masked, for default output. */
export function maskIngest(ingest: LiveIngest): LiveIngest {
  const srt = ingest.srt && {
    primary: ingest.srt.primary && maskSrtUrl(ingest.srt.primary),
    backup: ingest.srt.backup && maskSrtUrl(ingest.srt.backup),
  };
  return {
    ...ingest,
    streamKey: ingest.streamKey && maskSecret(ingest.streamKey),
    srt,
  };
}

/** Encoder settings as an OBS-style table: protocol, server, backup server. */
export function formatIngest(
  ingest: LiveIngest,
  output: OutputFormat | undefined,
): string {
  const rows: string[][] = [];
  for (const [label, pair] of [
    ["RTMPS (recommended)", ingest.rtmps],
    ["RTMP", ingest.rtmp],
    ["SRT", ingest.srt],
  ] as const) {
    if (pair) rows.push([label, dash(pair.primary), dash(pair.backup)]);
  }
  const table = formatTable(
    ["Protocol", "Server", "Backup server"],
    rows,
    output ?? "text",
  );
  const key = ingest.streamId
    ? `\nStream key: ${ingest.streamKey ?? "(none: auto-created streams publish with the library key)"}`
    : `\nAuto-create stream key: ${ingest.streamKey ?? "(not returned: the API only carries it in the SRT URLs, and SRT isn't configured for this library)"}`;
  return `${table}${key}`;
}

/** Encoder settings the ingest accepts, from the Stream Live docs. */
export const ENCODER_TIPS = [
  "Encoder: H.264 (8-bit 4:2:0) + stereo AAC 48 kHz, constant bitrate, 2s keyframe interval.",
  "1080p: 5,000-8,000 kbps, up to 60 fps. 4K: 8,000-25,000 kbps, up to 30 fps.",
  "RTMP(S): set the server and the stream key separately. SRT: the URL already carries the key.",
];
