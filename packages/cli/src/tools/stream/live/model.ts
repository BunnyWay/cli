import { createHmac } from "node:crypto";
import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/stream-live";
import { z } from "zod";
import type { ToolEnv } from "@/tools/context.ts";

export type LiveStreamModel = components["schemas"]["LiveStreamModel"];
export type CreateLiveStreamModel =
  components["schemas"]["CreateLiveStreamModel"];
export type PatchLiveStreamModel =
  components["schemas"]["PatchLiveStreamModel"];
export type IngestEndpointsModel = components["schemas"]["IngestEndpoints"];
export type LiveStreamStatusModel =
  components["schemas"]["LiveStreamStatusModel"];
export type BitrateEntryModel = components["schemas"]["RedisBitrateEntry"];
export type LiveEncodingStatisticsModel =
  components["schemas"]["LiveEncodingStatisticsModel"];

/** `LiveStreamStatus` values, indexed by their integer code. */
export const LIVE_STATUSES = [
  "unknown",
  "created",
  "scheduled",
  "preview",
  "running",
  "ended",
  "vodProcessing",
  "error",
] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** Human labels for the statuses, as the dashboard shows them. */
export const LIVE_STATUS_LABELS: Record<LiveStatus, string> = {
  unknown: "Unknown",
  created: "Created",
  scheduled: "Scheduled",
  preview: "Preview",
  running: "Live",
  ended: "Ended",
  vodProcessing: "Processing recording",
  error: "Error",
};

export function liveStatus(code: number | null | undefined): LiveStatus {
  return LIVE_STATUSES[code ?? 0] ?? "unknown";
}

/** Statuses after which nothing can be published, started or rotated again. */
export const FINISHED_STATUSES: readonly LiveStatus[] = [
  "ended",
  "vodProcessing",
];

/** `LiveStreamType`: Event (0) is a regular stream, Channel (1) a 24/7 one. */
export const STREAM_TYPES = ["event", "channel"] as const;
export type StreamType = (typeof STREAM_TYPES)[number];

export function streamTypeCode(type: StreamType): 0 | 1 {
  return type === "channel" ? 1 : 0;
}

/** The maximum DVR window, and the maximum length of an Event: 12 hours. */
export const MAX_DVR_WINDOW_SECONDS = 43_200;

/** Severity names, indexed by their integer code. */
const SEVERITIES = ["undefined", "info", "warning", "error"] as const;

/** `IssueCodes` names, indexed by their integer code; the live ones start at 13. */
const ISSUE_CODES = [
  "Undefined",
  "StreamLengthsDifference",
  "TranscodingWarnings",
  "IncompatibleResolution",
  "InvalidFramerate",
  "VideoExceededMaxDuration",
  "AudioExceededMaxDuration",
  "OriginalCorrupted",
  "TranscriptionFailed",
  "JitIncompatible",
  "JitFailed",
  "CaptionGenerationFailed",
  "UnsupportedFileType",
  "LiveNoEncoderCapacity",
  "LiveStreamBlocked",
  "LiveTooManyIngests",
  "LiveRegionConflict",
  "LivePublishAfterEnd",
  "LiveMediaStalled",
  "LiveEncoderLost",
  "LiveFailedOverToBackup",
  "LiveIngestRejected",
  "LiveIngestTimeout",
  "LiveMaxDurationReached",
  "LiveLibraryDisabled",
  "LiveDisconnectTimeout",
] as const;

export const LiveIssueSchema = z.object({
  time: z.string().nullable(),
  level: z.enum(SEVERITIES),
  code: z.string(),
  message: z.string(),
});
export type LiveIssue = z.infer<typeof LiveIssueSchema>;

export const LiveOutputSchema = z.object({
  endpoint: z.string(),
  /** Whether a destination stream key is set. The key itself is a third-party credential and never returned. */
  hasStreamKey: z.boolean(),
});

/**
 * A live stream without its stream key: the key is a publishing credential, so
 * only the `stream.live.ingest` tool, which is marked sensitive, returns it.
 */
export const LiveStreamSchema = z.object({
  id: z.string(),
  libraryId: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  collectionId: z.string().nullable(),
  status: z.enum(LIVE_STATUSES),
  type: z.enum(STREAM_TYPES),
  createdAt: z.string().nullable(),
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  autoStart: z.boolean(),
  recordVod: z.boolean(),
  dvr: z.object({
    enabled: z.boolean(),
    windowSeconds: z.number().nullable(),
  }),
  countdown: z.boolean(),
  trailerVideoId: z.string().nullable(),
  playbackUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  resolutions: z.array(z.string()),
  input: z
    .object({
      width: z.number().nullable(),
      height: z.number().nullable(),
      framerate: z.number().nullable(),
    })
    .nullable(),
  peakViewers: z.number().nullable(),
  totalViewerSeconds: z.number().nullable(),
  outputs: z.array(LiveOutputSchema),
  /** Problems the stream ran into, oldest first (refused publishes, failovers, abnormal stops). */
  issues: z.array(LiveIssueSchema),
});
export type LiveStream = z.infer<typeof LiveStreamSchema>;

function csv(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** An ISO 8601 date-time with no `Z` or `±hh:mm` offset, as the Live API sends them. */
const NAIVE_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Mark an API timestamp as UTC. The Live API sends UTC times without an offset
 * (`2026-11-26T20:00:00`), which `Date` would read as local time: off by the
 * viewer's UTC offset in text output, and not the ISO 8601 UTC JSON promises.
 */
export function utcTimestamp(value: string): string;
export function utcTimestamp(value: string | null | undefined): string | null;
export function utcTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return NAIVE_DATE_TIME.test(trimmed) ? `${trimmed}Z` : trimmed;
}

export function toLiveStream(model: LiveStreamModel): LiveStream {
  const outputs = model.outputs ?? model.rtmpOutputs ?? [];
  const hasInput =
    model.width != null || model.height != null || model.framerate != null;
  return {
    id: model.guid,
    libraryId: model.videoLibraryId,
    title: model.title,
    description: model.description ?? null,
    collectionId: model.collectionId || null,
    status: liveStatus(model.status),
    type: model.streamType === 1 ? "channel" : "event",
    createdAt: utcTimestamp(model.dateCreated),
    scheduledStart: utcTimestamp(model.scheduledStartTime),
    scheduledEnd: utcTimestamp(model.scheduledEndTime),
    startedAt: utcTimestamp(model.startedAt),
    endedAt: utcTimestamp(model.endedAt),
    durationSeconds: model.durationSeconds ?? null,
    autoStart: model.autoStartOnIngestDetected,
    recordVod: model.recordVod,
    dvr: {
      enabled: model.dvrEnabled,
      windowSeconds: model.dvrWindowSeconds ?? null,
    },
    countdown: model.enableCountdown ?? false,
    trailerVideoId: model.preStreamTrailerVideoId || null,
    playbackUrl: model.playbackUrlHls || null,
    thumbnailUrl: model.thumbnailUrl || null,
    resolutions: csv(model.availableResolutions),
    input: hasInput
      ? {
          width: model.width ?? null,
          height: model.height ?? null,
          framerate: model.framerate ?? null,
        }
      : null,
    peakViewers: model.peakConcurrentViewers ?? null,
    totalViewerSeconds: model.totalViewerSeconds ?? null,
    outputs: outputs.map((output) => ({
      endpoint: output.endpoint ?? "",
      hasStreamKey: Boolean(output.streamKey),
    })),
    issues: (model.transcodingMessages ?? []).map((message) => ({
      time: utcTimestamp(message.timeStamp),
      level: SEVERITIES[message.level ?? 0] ?? "undefined",
      code: ISSUE_CODES[message.issueCode ?? 0] ?? String(message.issueCode),
      message: message.message ?? "",
    })),
  };
}

const IngestPairSchema = z.object({
  primary: z.string().nullable(),
  backup: z.string().nullable(),
});

/**
 * Where an encoder publishes. RTMP and RTMPS take the stream key as a separate
 * field (or appended as the last path segment); the SRT URLs already carry it.
 */
export const LiveIngestSchema = z.object({
  libraryId: z.number(),
  /** The live stream, or null for the library's auto-create stream key. */
  streamId: z.string().nullable(),
  /**
   * The key to append to the RTMP(S) server URL. For the library's auto-create
   * ingest it is the library's auto-create stream key, read from the SRT URLs
   * (the API returns it nowhere else); null when SRT isn't configured, and for
   * an auto-created stream, which publishes with the library's key.
   */
  streamKey: z.string().nullable(),
  rtmp: IngestPairSchema.nullable(),
  rtmps: IngestPairSchema.nullable(),
  /** Null when SRT ingest isn't configured or the stream was auto-created. */
  srt: IngestPairSchema.nullable(),
  /** Set when part of the settings couldn't be read, e.g. the endpoints right after a key rotation. */
  warning: z.string().optional(),
});
export type LiveIngest = z.infer<typeof LiveIngestSchema>;

function pair(
  config:
    | { primaryIngestUrl?: string | null; backupIngestUrl?: string | null }
    | null
    | undefined,
): z.infer<typeof IngestPairSchema> | null {
  if (!config?.primaryIngestUrl && !config?.backupIngestUrl) return null;
  return {
    primary: config.primaryIngestUrl || null,
    backup: config.backupIngestUrl || null,
  };
}

/** The stream key an SRT URL carries in `streamid=publish:live/<key>`; null when it has none. */
export function srtStreamKey(url: string | null | undefined): string | null {
  const match = url ? /[?&]streamid=publish:live\/([^&#]+)/i.exec(url) : null;
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function toLiveIngest(
  libraryId: number,
  streamId: string | null,
  streamKey: string | null,
  endpoints: IngestEndpointsModel | null | undefined,
): LiveIngest {
  const srt = pair(endpoints?.srt);
  // The auto-create endpoints carry the library's key only inside the SRT
  // URLs, yet RTMP(S) encoders need it as a separate stream key.
  const key =
    streamKey ||
    (streamId === null
      ? (srtStreamKey(srt?.primary) ?? srtStreamKey(srt?.backup))
      : null);
  return {
    libraryId,
    streamId,
    streamKey: key || null,
    rtmp: pair(endpoints?.rtmp),
    rtmps: pair(endpoints?.rtmps),
    srt,
  };
}

export const LiveStatusSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(LIVE_STATUSES),
  /** True once an encoder publishes and the stream can be started. */
  readyToStart: z.boolean(),
  primaryLive: z.boolean(),
  backupLive: z.boolean(),
  /** Whether an active stream is waiting for playable media (startup or reconnect); null when unknown. */
  disconnected: z.boolean().nullable(),
  lastPingMs: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  /** The latest primary ingest bitrate in kbps; null before the first sample. */
  bitrateKbps: z.number().nullable(),
  checkedAt: z.string().nullable(),
});
export type LiveStatusReport = z.infer<typeof LiveStatusSchema>;

export const BitrateSampleSchema = z.object({
  time: z.string(),
  kbps: z.number(),
});

export const BitrateHistorySchema = z.object({
  id: z.string(),
  primary: z.array(BitrateSampleSchema),
  backup: z.array(BitrateSampleSchema),
});
export type BitrateHistory = z.infer<typeof BitrateHistorySchema>;

export function toSamples(
  entries: BitrateEntryModel[] | null | undefined,
): z.infer<typeof BitrateSampleSchema>[] {
  return (entries ?? [])
    .filter((entry) => entry.dateTime)
    .map((entry) => ({
      time: utcTimestamp(entry.dateTime as string),
      kbps: entry.value ?? 0,
    }));
}

/** Statuses a stream can be previewed in; once public or ended there is no preview. */
export const PREVIEWABLE_STATUSES: readonly LiveStatus[] = [
  "created",
  "scheduled",
  "preview",
];

/** Preview access from the API lasts at most this long (or until the stream goes public). */
export const PREVIEW_API_MAX_SECONDS = 10 * 3600;

/** A self-signed preview token may expire at most 10h05m from now. */
export const PREVIEW_SIGNED_MAX_SECONDS = 10 * 3600 + 5 * 60;

const PLAYER_HOST = "https://player.mediadelivery.net";

export const PreviewAccessSchema = z.object({
  id: z.string(),
  libraryId: z.number(),
  /** `api`: issued by the preview endpoint (option 1). `signed`: signed locally with the stream key (option 2). */
  method: z.enum(["api", "signed"]),
  /** The player embed URL that plays the preview. */
  playerUrl: z.string(),
  /** The same, as a standalone player page. */
  playUrl: z.string(),
  /** Query string for the player URL, without the leading `?`. */
  playerQuery: z.string(),
  /** HLS playlist, CDN-signed when the library needs it. Only the API issues one. */
  playlistUrl: z.string().nullable(),
  /** When the access stops working; it also stops when the stream goes public. */
  expiresAt: z.string(),
  /**
   * Whether the library requires an embed view token that the query lacks.
   * The API adds `token` and `expires` itself; a self-signed token can't.
   */
  viewTokenMissing: z.boolean(),
});
export type PreviewAccess = z.infer<typeof PreviewAccessSchema>;

export function previewPlayerUrls(
  libraryId: number,
  streamId: string,
  query: string,
): { playerUrl: string; playUrl: string } {
  const q = query.replace(/^\?/, "");
  return {
    playerUrl: `${PLAYER_HOST}/embed/${libraryId}/${streamId}?${q}`,
    playUrl: `${PLAYER_HOST}/play/${libraryId}/${streamId}?${q}`,
  };
}

/**
 * A preview token (option 2): HMAC-SHA256 keyed with the stream key over
 * `/live/{streamId}/preview/{expires}`, base64url without padding, prefixed
 * `HS256-`. The stream ID is the lowercase, hyphenated GUID.
 */
export function signPreviewToken(
  streamKey: string,
  streamId: string,
  expires: number,
): string {
  const signature = createHmac("sha256", streamKey)
    .update(`/live/${streamId.toLowerCase()}/preview/${expires}`)
    .digest("base64url");
  return `HS256-${signature}`;
}

const SecondsByKey = z.record(z.string(), z.number());

export const LiveEncodingBreakdownSchema = z.object({
  totalSeconds: z.number(),
  chart: SecondsByKey,
  byStream: SecondsByKey,
  byCodec: SecondsByKey,
  byResolution: SecondsByKey,
});

export const LiveEncodingStatsSchema = z.object({
  libraryId: z.number(),
  hourly: z.boolean(),
  total: LiveEncodingBreakdownSchema,
  primary: LiveEncodingBreakdownSchema,
  backup: LiveEncodingBreakdownSchema,
});
export type LiveEncodingStats = z.infer<typeof LiveEncodingStatsSchema>;

function breakdown(
  model: LiveEncodingStatisticsModel["total"],
): z.infer<typeof LiveEncodingBreakdownSchema> {
  return {
    totalSeconds: model?.totalEncodingSeconds ?? 0,
    chart: model?.encodingSecondsChart ?? {},
    byStream: model?.encodingSecondsByLiveStream ?? {},
    byCodec: model?.encodingSecondsByVideoCodec ?? {},
    byResolution: model?.encodingSecondsByResolution ?? {},
  };
}

export function toLiveEncodingStats(
  libraryId: number,
  model: LiveEncodingStatisticsModel | undefined,
): LiveEncodingStats {
  return {
    libraryId,
    hourly: model?.hourly ?? false,
    total: breakdown(model?.total),
    primary: breakdown(model?.primary),
    backup: breakdown(model?.backup),
  };
}

/**
 * A restream destination. Its stream key is a credential for another
 * platform, so it is never input: the input names the environment variable
 * that holds it, and the tool reads it from `ctx.env`.
 */
export const OutputInputSchema = z.strictObject({
  endpoint: z
    .string()
    .trim()
    .regex(/^rtmps?:\/\//i, "must start with rtmp:// or rtmps://")
    .describe(
      "Destination ingest URL without the key, e.g. `rtmps://a.rtmp.youtube.com/live2`.",
    ),
  streamKeyEnv: z
    .string()
    .trim()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable name")
    .describe(
      "Name of the environment variable that holds the destination's stream key, e.g. `YOUTUBE_STREAM_KEY`. The key itself is never input.",
    ),
});
export type OutputInput = z.infer<typeof OutputInputSchema>;

/** Restream destinations as the API takes them, with each key read from the environment. */
export function resolveOutputs(
  outputs: readonly OutputInput[],
  env: ToolEnv,
): Array<{ endpoint: string; streamKey: string }> {
  const missing = [
    ...new Set(
      outputs
        .filter((o) => !env[o.streamKeyEnv]?.trim())
        .map((o) => o.streamKeyEnv),
    ),
  ];
  if (missing.length > 0) {
    throw new UserError(
      `Missing restream stream key${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
      `Set ${missing.join(", ")} in the environment to the destination's stream key.`,
    );
  }
  return outputs.map((o) => ({
    endpoint: o.endpoint,
    streamKey: (env[o.streamKeyEnv] ?? "").trim(),
  }));
}

/** The settings `stream.live.create` and `stream.live.update` share. */
export const LiveSettingsSchema = z.object({
  description: z
    .string()
    .nullable()
    .optional()
    .describe("Description; null removes it (update only)."),
  collectionId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Collection ID to put the stream in; null removes it (update only).",
    ),
  type: z
    .enum(STREAM_TYPES)
    .optional()
    .describe(
      "`event` (default) ends after 12 hours and can be recorded; `channel` runs 24/7, survives disconnects, and is never recorded.",
    ),
  recordVod: z
    .boolean()
    .optional()
    .describe(
      "Save the stream as a video when it stops. Not allowed for a channel.",
    ),
  autoStart: z
    .boolean()
    .optional()
    .describe("Go live as soon as an encoder connects, skipping preview."),
  dvrWindowSeconds: z
    .number()
    .int()
    .min(0)
    .max(MAX_DVR_WINDOW_SECONDS)
    .optional()
    .describe("DVR (rewind) window in seconds, up to 43200; 0 turns DVR off."),
  scheduledStart: z
    .string()
    .nullable()
    .optional()
    .describe("Scheduled start, ISO 8601 UTC; null removes it (update only)."),
  scheduledEnd: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Scheduled end (auto-stop), ISO 8601 UTC; null removes it (update only).",
    ),
  countdown: z
    .boolean()
    .optional()
    .describe(
      "Show a countdown in the player before a scheduled start. Left out, a scheduled stream uses the library's setting.",
    ),
  trailerVideoId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Video GUID to loop before the stream starts; null removes it (update only).",
    ),
  outputs: z
    .array(OutputInputSchema)
    .max(4)
    .optional()
    .describe(
      "Restream destinations, up to 4, each with the environment variable holding its stream key. Replaces the whole list; an empty list removes them all.",
    ),
});
export type LiveSettings = z.infer<typeof LiveSettingsSchema>;

/** Checks every create and update shares, before any request. */
export function assertLiveSettings(settings: LiveSettings): void {
  if (settings.type === "channel" && settings.recordVod === true) {
    throw new UserError(
      "A channel can't be recorded.",
      "Channels run 24/7 and never record a video; drop `recordVod` or use the `event` type.",
    );
  }
  const start = settings.scheduledStart
    ? Date.parse(settings.scheduledStart)
    : undefined;
  const end = settings.scheduledEnd
    ? Date.parse(settings.scheduledEnd)
    : undefined;
  if (start !== undefined && Number.isNaN(start))
    throw new UserError(
      `Invalid scheduled start "${settings.scheduledStart}".`,
      "Use ISO 8601, e.g. 2026-12-01T18:00:00Z.",
    );
  if (end !== undefined && Number.isNaN(end))
    throw new UserError(
      `Invalid scheduled end "${settings.scheduledEnd}".`,
      "Use ISO 8601, e.g. 2026-12-01T20:00:00Z.",
    );
  if (start !== undefined && end !== undefined && end <= start)
    throw new UserError("The scheduled end must be after the scheduled start.");
  if (
    settings.type !== "channel" &&
    start !== undefined &&
    end !== undefined &&
    end - start > MAX_DVR_WINDOW_SECONDS * 1000
  ) {
    throw new UserError(
      "An event can run for at most 12 hours.",
      "Schedule the end within 12 hours of the start, or use the `channel` type.",
    );
  }
}

/** Map settings to the API's field names, sending only what was given. */
export function liveSettingsBody(
  settings: LiveSettings,
  env: ToolEnv = {},
): PatchLiveStreamModel {
  const body: PatchLiveStreamModel = {};
  if (settings.description !== undefined)
    body.description = settings.description;
  if (settings.collectionId !== undefined)
    body.collectionId = settings.collectionId;
  if (settings.type !== undefined)
    body.streamType = streamTypeCode(settings.type);
  if (settings.recordVod !== undefined) body.recordVod = settings.recordVod;
  if (settings.autoStart !== undefined)
    body.autoStartOnIngestDetected = settings.autoStart;
  if (settings.dvrWindowSeconds !== undefined) {
    body.dvrEnabled = settings.dvrWindowSeconds > 0;
    if (settings.dvrWindowSeconds > 0)
      body.dvrWindowSeconds = settings.dvrWindowSeconds;
  }
  if (settings.scheduledStart !== undefined)
    body.scheduledStartTime = settings.scheduledStart;
  if (settings.scheduledEnd !== undefined)
    body.scheduledEndTime = settings.scheduledEnd;
  if (settings.countdown !== undefined)
    body.enableCountdown = settings.countdown;
  if (settings.trailerVideoId !== undefined)
    body.preStreamTrailerVideoId = settings.trailerVideoId;
  if (settings.outputs !== undefined)
    body.outputs = resolveOutputs(settings.outputs, env);
  return body;
}
