import { readFile } from "node:fs/promises";
import { ApiError, UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { StreamClient, ToolContext } from "@/tools/context.ts";
import { defineTool } from "@/tools/define-tool.ts";
import { fetchLibrary } from "@/tools/stream/api.ts";
import {
  assertLiveSettings,
  type BitrateHistory,
  BitrateHistorySchema,
  FINISHED_STATUSES,
  LIVE_STATUS_LABELS,
  type LiveEncodingStats,
  LiveEncodingStatsSchema,
  type LiveIngest,
  LiveIngestSchema,
  LiveSettingsSchema,
  type LiveStatusReport,
  LiveStatusSchema,
  type LiveStream,
  type LiveStreamModel,
  LiveStreamSchema,
  liveSettingsBody,
  liveStatus,
  PREVIEW_SIGNED_MAX_SECONDS,
  PREVIEWABLE_STATUSES,
  type PreviewAccess,
  PreviewAccessSchema,
  previewPlayerUrls,
  signPreviewToken,
  toLiveEncodingStats,
  toLiveIngest,
  toLiveStream,
  toSamples,
  utcTimestamp,
} from "./model.ts";

export * from "./model.ts";

const libraryId = z
  .number()
  .int()
  .positive()
  .describe("Video library ID, e.g. `12345`.");

const streamId = z
  .string()
  .trim()
  .min(1)
  .describe("Live stream ID (a GUID), e.g. `0f4e5d6c-...`.");

const title = z.string().trim().min(1).max(255);

/** The library, and a Stream client on it authenticated with the library's own key. */
async function openLiveLibrary(ctx: ToolContext, library: number) {
  const model = await fetchLibrary(ctx.clients.core, library, {
    signal: ctx.signal,
  });
  if (!model.ApiKey) {
    throw new UserError(
      `No API key available for video library ${model.Name || library}.`,
      "Live stream operations need the library's own Stream API key; check that the account key can read it.",
    );
  }
  return { model, client: ctx.clients.streamLibrary(model.ApiKey) };
}

/** Open a Stream client on one library, authenticated with that library's own key. */
async function liveClient(
  ctx: ToolContext,
  library: number,
): Promise<StreamClient> {
  return (await openLiveLibrary(ctx, library)).client;
}

const NO_PREVIEW = (status: string) =>
  new UserError(
    `This live stream has no preview: it is ${status}.`,
    "Preview access exists only while a stream is Created, Scheduled or in Preview. Once public, watch it through its playback URL.",
  );

/** Turn a 404 into a message naming the stream; other errors pass through. */
async function orNotFound<T>(
  stream: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new UserError(
        `Live stream ${stream} not found.`,
        "Check the ID; the library's live streams are listed by `stream.live.list`.",
      );
    }
    throw err;
  }
}

async function fetchStream(
  ctx: ToolContext,
  client: StreamClient,
  library: number,
  stream: string,
): Promise<LiveStreamModel> {
  const { data } = await orNotFound(stream, () =>
    client.GET("/library/{libraryId}/live/{streamId}", {
      params: { path: { libraryId: library, streamId: stream } },
      signal: ctx.signal,
    }),
  );
  if (!data) throw new UserError(`Live stream ${stream} not found.`);
  return data;
}

/**
 * The live stream a mutating call answered with. The spec types these responses
 * as a bare `LiveStreamModel`, but some (`stop`, in the preview API) wrap it in a
 * `{ data, success, message }` envelope, so both shapes are accepted.
 */
export function requireModel(
  data: LiveStreamModel | undefined,
  action: string,
): LiveStreamModel {
  const model = unwrapEnvelope(data);
  if (!model)
    throw new UserError(`The API returned no live stream after ${action}.`);
  return model;
}

function unwrapEnvelope(
  data: LiveStreamModel | undefined,
): LiveStreamModel | undefined {
  if (!data || typeof data !== "object") return undefined;
  if ("guid" in data) return data;
  const inner = (data as { data?: unknown }).data;
  return inner && typeof inner === "object" && "guid" in inner
    ? (inner as LiveStreamModel)
    : undefined;
}

export const streamLiveList = defineTool({
  name: "stream.live.list",
  title: "List live streams",
  description:
    "List the live streams in a video library, newest first unless ordered otherwise. Never includes stream keys.",
  schema: z.strictObject({
    library: libraryId,
    search: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Only streams whose title or ID contains this text."),
    collection: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Only streams in this collection ID."),
    orderBy: z
      .enum(["date", "title", "status", "started", "ended", "planned"])
      .optional()
      .describe("Sort order; defaults to `date`."),
  }),
  kind: "read",
  resultSchema: z.array(LiveStreamSchema),
  examples: [[{ library: 12345 }, "List every live stream in a library"]],
  run: async (ctx, { library, search, collection, orderBy }) => {
    const client = await liveClient(ctx, library);
    ctx.progress("Fetching live streams...");
    const streams: LiveStream[] = [];
    for (let page = 1; ; page++) {
      const { data } = await client.GET("/library/{libraryId}/live", {
        params: {
          path: { libraryId: library },
          query: {
            page,
            itemsPerPage: 1000,
            search,
            collectionId: collection,
            orderBy,
          },
        },
        signal: ctx.signal,
      });
      const items = data?.items ?? [];
      streams.push(...items.map(toLiveStream));
      if (items.length === 0 || streams.length >= (data?.totalItems ?? 0))
        break;
    }
    return streams;
  },
});

export const streamLiveGet = defineTool({
  name: "stream.live.get",
  title: "Get a live stream",
  description:
    "Get one live stream: status, schedule, recording, DVR, playback URL, restream outputs and any issues it ran into. Never includes the stream key.",
  schema: z.strictObject({ library: libraryId, stream: streamId }),
  kind: "read",
  resultSchema: LiveStreamSchema,
  run: async (ctx, { library, stream }) => {
    const client = await liveClient(ctx, library);
    ctx.progress("Fetching live stream...");
    return toLiveStream(await fetchStream(ctx, client, library, stream));
  },
});

export const streamLiveCreate = defineTool({
  name: "stream.live.create",
  title: "Create a live stream",
  description:
    "Create a live stream in a video library. Settings left out use the library's live defaults; the type defaults to `event`. Publishing to it does not make it public until it is started, unless `autoStart` is on. Returns the stream without its key: read that with `stream.live.ingest`.",
  schema: LiveSettingsSchema.extend({
    library: libraryId,
    title: title.describe("Title, e.g. `Launch keynote`."),
  }).strict(),
  kind: "write",
  resultSchema: LiveStreamSchema,
  examples: [
    [{ library: 12345, title: "Launch keynote" }, "Create an event"],
    [
      { library: 12345, title: "24/7 radio", type: "channel" },
      "Create a 24/7 channel",
    ],
  ],
  run: async (ctx, { library, title, ...settings }) => {
    assertLiveSettings(settings);
    const client = await liveClient(ctx, library);
    ctx.progress("Creating live stream...");
    // null clears a field on update; on create it just means "not set".
    const body = Object.fromEntries(
      Object.entries(liveSettingsBody(settings, ctx.env)).filter(
        ([, v]) => v !== null,
      ),
    );
    try {
      const { data } = await client.POST("/library/{libraryId}/live", {
        params: { path: { libraryId: library } },
        body: { ...body, title, public: true },
        signal: ctx.signal,
      });
      return toLiveStream(requireModel(data, "creating it"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        throw new UserError(
          "The account has reached its limit of concurrent live streams.",
          "Stop or delete a live stream that is not in use, then try again.",
        );
      }
      if (err instanceof ApiError && err.status === 402) {
        throw new UserError(
          "Live streaming needs a payment card on the account.",
          "Add a payment method in the bunny.net dashboard to leave the free trial.",
        );
      }
      throw err;
    }
  },
});

export const streamLiveUpdate = defineTool({
  name: "stream.live.update",
  title: "Update a live stream",
  description:
    "Change a live stream's settings; only the fields given are sent, and null removes an optional one. While the stream is running only the title, description and scheduled end can change.",
  schema: LiveSettingsSchema.extend({
    library: libraryId,
    stream: streamId,
    title: title.optional().describe("New title."),
  }).strict(),
  kind: "write",
  resultSchema: LiveStreamSchema,
  examples: [
    [
      { library: 12345, stream: "0f4e5d6c-...", scheduledEnd: null },
      "Stop ending the stream automatically",
    ],
  ],
  run: async (ctx, { library, stream, title, ...settings }) => {
    assertLiveSettings(settings);
    const body = {
      ...liveSettingsBody(settings, ctx.env),
      ...(title ? { title } : {}),
    };
    if (Object.keys(body).length === 0)
      throw new UserError("No live stream changes requested.");
    const client = await liveClient(ctx, library);
    ctx.progress("Updating live stream...");
    const { data } = await orNotFound(stream, () =>
      client.PATCH("/library/{libraryId}/live/{streamId}", {
        params: { path: { libraryId: library, streamId: stream } },
        body,
        headers: { "Content-Type": "application/merge-patch+json" },
        signal: ctx.signal,
      }),
    );
    return toLiveStream(requireModel(data, "updating it"));
  },
});

export const DeletedLiveStreamSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
});

export const streamLiveDelete = defineTool({
  name: "stream.live.delete",
  title: "Delete a live stream",
  description:
    "Delete a live stream and everything attached to it. Cannot be undone. A recording already saved as a video stays in the library.",
  schema: z.strictObject({ library: libraryId, stream: streamId }),
  kind: "destructive",
  resultSchema: DeletedLiveStreamSchema,
  run: async (ctx, { library, stream }) => {
    const client = await liveClient(ctx, library);
    ctx.progress("Deleting live stream...");
    await orNotFound(stream, () =>
      client.DELETE("/library/{libraryId}/live/{streamId}", {
        params: { path: { libraryId: library, streamId: stream } },
        signal: ctx.signal,
      }),
    );
    return { id: stream, deleted: true as const };
  },
});

export const streamLiveStart = defineTool({
  name: "stream.live.start",
  title: "Start a live stream",
  description:
    "Take a live stream public: viewers can watch it, and recording starts if `recordVod` is on. Overrides a scheduled start. Nothing published before the start is recorded, so start it while the encoder is publishing.",
  schema: z.strictObject({ library: libraryId, stream: streamId }),
  kind: "write",
  resultSchema: LiveStreamSchema,
  run: async (ctx, { library, stream }) => {
    const client = await liveClient(ctx, library);
    ctx.progress("Starting live stream...");
    try {
      const { data } = await orNotFound(stream, () =>
        client.PUT("/library/{libraryId}/live/{streamId}/start", {
          params: { path: { libraryId: library, streamId: stream } },
          signal: ctx.signal,
        }),
      );
      return toLiveStream(requireModel(data, "starting it"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        throw new UserError(
          "The live stream could not be started right now.",
          "Nothing changed; try again in a few seconds.",
        );
      }
      throw err;
    }
  },
});

export const streamLiveStop = defineTool({
  name: "stream.live.stop",
  title: "Stop a live stream",
  description:
    "End a running live stream: the encoder is disconnected and, with `recordVod` on, the recording is saved as a video. Cannot be undone; an ended stream can't be restarted.",
  schema: z.strictObject({ library: libraryId, stream: streamId }),
  kind: "destructive",
  resultSchema: LiveStreamSchema,
  run: async (ctx, { library, stream }) => {
    const client = await liveClient(ctx, library);
    ctx.progress("Stopping live stream...");
    const { data } = await orNotFound(stream, () =>
      client.PUT("/library/{libraryId}/live/{streamId}/stop", {
        params: { path: { libraryId: library, streamId: stream } },
        signal: ctx.signal,
      }),
    );
    return toLiveStream(requireModel(data, "stopping it"));
  },
});

async function fetchIngestEndpoints(
  ctx: ToolContext,
  client: StreamClient,
  library: number,
  stream?: string,
) {
  const { data } = await client.GET(
    "/library/{libraryId}/live/ingest-endpoints",
    {
      params: {
        path: { libraryId: library },
        query: stream ? { liveStreamId: stream } : {},
      },
      signal: ctx.signal,
    },
  );
  return data;
}

export const streamLiveIngest = defineTool({
  name: "stream.live.ingest",
  title: "Get live ingest settings",
  description:
    "Get where an encoder publishes: RTMP, RTMPS and SRT primary and backup URLs, plus the stream key. Without `stream`, returns the library's auto-create ingest URLs, where publishing creates and starts a new stream, and the auto-create stream key (null when SRT isn't configured, since the API carries it only in the SRT URLs). The stream key is a publishing credential.",
  schema: z.strictObject({
    library: libraryId,
    stream: streamId
      .optional()
      .describe(
        "Live stream ID; leave out for the library's auto-create ingest.",
      ),
  }),
  kind: "read",
  sensitive: true,
  resultSchema: LiveIngestSchema,
  run: async (ctx, { library, stream }): Promise<LiveIngest> => {
    const client = await liveClient(ctx, library);
    ctx.progress("Fetching ingest settings...");
    if (!stream) {
      const endpoints = await fetchIngestEndpoints(ctx, client, library);
      return toLiveIngest(library, null, null, endpoints);
    }
    const model = await fetchStream(ctx, client, library, stream);
    const endpoints =
      model.ingestEndpoints ??
      (await fetchIngestEndpoints(ctx, client, library, stream));
    return toLiveIngest(library, stream, model.streamKey, endpoints);
  },
});

export const streamLiveRotateKey = defineTool({
  name: "stream.live.rotatekey",
  title: "Regenerate a live stream key",
  description:
    "Replace a live stream's stream key and return the new ingest settings. Encoders using the old key are disconnected within seconds; a live stream keeps going if they reconnect with the new key within the reconnect window. Every preview token signed with the old key stops working. Not allowed once the stream has ended.",
  schema: z.strictObject({ library: libraryId, stream: streamId }),
  kind: "destructive",
  sensitive: true,
  resultSchema: LiveIngestSchema,
  run: async (ctx, { library, stream }): Promise<LiveIngest> => {
    const client = await liveClient(ctx, library);
    ctx.progress("Regenerating the stream key...");
    const { data } = await orNotFound(stream, () =>
      client.PUT("/library/{libraryId}/live/{streamId}/regenerate-key", {
        params: { path: { libraryId: library, streamId: stream } },
        signal: ctx.signal,
      }),
    );
    const model = requireModel(data, "regenerating its key");
    // SRT URLs carry the key, so read them back rather than reuse stale ones.
    // The old key is already dead, so a failed read-back must not lose the new
    // one: fall back to the RTMP(S) servers, which carry no key, and say so.
    try {
      const endpoints = await fetchIngestEndpoints(
        ctx,
        client,
        library,
        stream,
      );
      return toLiveIngest(library, stream, model.streamKey, endpoints);
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      const endpoints = model.ingestEndpoints && {
        ...model.ingestEndpoints,
        srt: null,
      };
      return {
        ...toLiveIngest(library, stream, model.streamKey, endpoints),
        warning: `The key was rotated, but the ingest endpoints couldn't be read back (${err instanceof Error ? err.message : String(err)}), so SRT is left out. Run \`bunny stream live ingest ${stream}\` for the full settings.`,
      };
    }
  },
});

export const streamLiveStatus = defineTool({
  name: "stream.live.status",
  title: "Get live stream health",
  description:
    "Get a live stream's current state: whether primary and backup encoders are publishing, whether it's ready to start, how long it has run, and the latest ingest bitrate.",
  schema: z.strictObject({ library: libraryId, stream: streamId }),
  kind: "read",
  resultSchema: LiveStatusSchema,
  run: async (ctx, { library, stream }): Promise<LiveStatusReport> => {
    const client = await liveClient(ctx, library);
    ctx.progress("Checking live stream...");
    const path = { libraryId: library, streamId: stream };
    const model = await fetchStream(ctx, client, library, stream);
    const [{ data: health }, bitrate] = await Promise.all([
      client.GET("/library/{libraryId}/live/{streamId}/status", {
        params: { path },
        signal: ctx.signal,
      }),
      // 404 until the first sample arrives (and, a known issue, during preview).
      client
        .GET("/library/{libraryId}/live/{streamId}/current-bitrate", {
          params: { path },
          signal: ctx.signal,
        })
        .then(({ data }) => data?.value ?? null)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
    ]);
    return {
      id: stream,
      title: model.title,
      status: liveStatus(model.status),
      readyToStart: health?.readyToStart ?? false,
      primaryLive: health?.primaryLive ?? false,
      backupLive: health?.backupLive ?? false,
      disconnected: health?.isDisconnected ?? null,
      lastPingMs: health?.lastPingAgo ?? null,
      durationSeconds: health?.duration ?? null,
      bitrateKbps: bitrate,
      checkedAt: utcTimestamp(health?.statusTimeUtc),
    };
  },
});

const isoTime = z
  .string()
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "must be an ISO 8601 time",
  );

export const streamLiveBitrate = defineTool({
  name: "stream.live.bitrate",
  title: "Get live bitrate history",
  description:
    "Get a live stream's recorded ingest bitrate (kbps) for the primary and backup encoders, averaged into short buckets, optionally within a time range.",
  schema: z.strictObject({
    library: libraryId,
    stream: streamId,
    from: isoTime.optional().describe("Start of the range, ISO 8601 UTC."),
    to: isoTime.optional().describe("End of the range, ISO 8601 UTC."),
  }),
  kind: "read",
  resultSchema: BitrateHistorySchema,
  run: async (ctx, { library, stream, from, to }): Promise<BitrateHistory> => {
    const client = await liveClient(ctx, library);
    ctx.progress("Fetching bitrate history...");
    const { data } = await orNotFound(stream, () =>
      client.GET("/library/{libraryId}/live/{streamId}/bitrate-history", {
        params: {
          path: { libraryId: library, streamId: stream },
          query: { startTime: from, endTime: to },
        },
        signal: ctx.signal,
      }),
    );
    return {
      id: stream,
      primary: toSamples(data?.primary),
      backup: toSamples(data?.backup),
    };
  },
});

export const streamLivePreview = defineTool({
  name: "stream.live.preview",
  title: "Get live preview access",
  description:
    "Get token-authenticated access for watching a live stream privately before it goes public (requested from the API; recommended): a player URL carrying `previewToken` and `previewExpires` (plus the view `token` and `expires` when the library requires one) and a CDN-signed HLS playlist. Only while the stream is Created, Scheduled or in Preview; access lasts 10 hours or until the stream goes public, whichever comes first. The URLs are credentials until they expire.",
  schema: z.strictObject({ library: libraryId, stream: streamId }),
  kind: "read",
  sensitive: true,
  resultSchema: PreviewAccessSchema,
  run: async (ctx, { library, stream }): Promise<PreviewAccess> => {
    const client = await liveClient(ctx, library);
    ctx.progress("Requesting preview access...");
    try {
      const { data } = await orNotFound(stream, () =>
        client.GET("/library/{libraryId}/live/{streamId}/preview", {
          params: { path: { libraryId: library, streamId: stream } },
          signal: ctx.signal,
        }),
      );
      const query = (data?.playerQueryParameters ?? "").replace(/^\?/, "");
      if (!query || !data?.expiresAt) {
        throw new UserError("The API returned no preview access.");
      }
      return {
        id: stream,
        libraryId: library,
        method: "api",
        ...previewPlayerUrls(library, stream, query),
        playerQuery: query,
        playlistUrl: data.playlistUrl || null,
        expiresAt: data.expiresAt,
        viewTokenMissing: false,
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409)
        throw NO_PREVIEW("already public or has ended");
      throw err;
    }
  },
});

export const streamLivePreviewSign = defineTool({
  name: "stream.live.preview.sign",
  title: "Sign live preview access",
  description:
    "Sign a preview token locally with the live stream's stream key (HMAC-SHA256 over `/live/{streamId}/preview/{expires}`), for watching it before it goes public without requesting access from the API. `expiresIn` is at most 10h05m. Regenerating the stream key invalidates every token signed this way. No CDN-signed playlist is returned, and when the library requires an embed view token the result says so: add `token` and `expires` yourself. Auto-created streams, and API keys without Update permission, have no stream key to sign with: use `stream.live.preview`.",
  schema: z.strictObject({
    library: libraryId,
    stream: streamId,
    expiresIn: z
      .number()
      .int()
      .min(60)
      .max(PREVIEW_SIGNED_MAX_SECONDS)
      .default(3600)
      .describe(
        "Seconds until the token expires, 60 to 36300 (10h05m); default 3600.",
      ),
  }),
  kind: "read",
  sensitive: true,
  resultSchema: PreviewAccessSchema,
  run: async (ctx, { library, stream, expiresIn }): Promise<PreviewAccess> => {
    const { model: lib, client } = await openLiveLibrary(ctx, library);
    ctx.progress("Fetching the stream key...");
    const model = await fetchStream(ctx, client, library, stream);
    const status = liveStatus(model.status);
    if (!PREVIEWABLE_STATUSES.includes(status))
      throw NO_PREVIEW(LIVE_STATUS_LABELS[status].toLowerCase());
    if (!model.streamKey) {
      throw new UserError(
        `No stream key available to sign a preview for ${model.title}.`,
        "Auto-created streams publish with the library key, and keys without Update permission get it redacted. Request preview access from the API (`stream.live.preview`) instead.",
      );
    }
    // The GUID as signed must be lowercase and hyphenated, as the API returns it.
    const id = model.guid.toLowerCase();
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const token = signPreviewToken(model.streamKey, id, expires);
    const query = `previewToken=${encodeURIComponent(token)}&previewExpires=${expires}`;
    return {
      id,
      libraryId: library,
      method: "signed",
      ...previewPlayerUrls(library, id, query),
      playerQuery: query,
      playlistUrl: null,
      expiresAt: new Date(expires * 1000).toISOString(),
      viewTokenMissing: lib.PlayerTokenAuthenticationEnabled ?? false,
    };
  },
});

export const ThumbnailResultSchema = z.object({
  id: z.string(),
  thumbnail: z.enum(["set", "removed"]),
});
export type ThumbnailResult = z.infer<typeof ThumbnailResultSchema>;

export const streamLiveThumbnailSet = defineTool({
  name: "stream.live.thumbnail.set",
  title: "Set a live stream thumbnail",
  description:
    "Set a live stream's thumbnail from a local image file or a public image URL that bunny.net fetches.",
  schema: z
    .strictObject({
      library: libraryId,
      stream: streamId,
      file: z
        .string()
        .min(1)
        .optional()
        .describe("Local image file to upload."),
      url: z
        .url()
        .optional()
        .describe("Public image URL for bunny.net to fetch."),
    })
    .refine((input) => Boolean(input.file) !== Boolean(input.url), {
      message: "pass exactly one of `file` or `url`",
    }),
  kind: "write",
  localFiles: true,
  resultSchema: ThumbnailResultSchema,
  run: async (
    ctx,
    { library, stream, file, url },
  ): Promise<ThumbnailResult> => {
    const bytes = file ? await readFile(file) : undefined;
    const client = await liveClient(ctx, library);
    ctx.progress("Setting thumbnail...");
    await orNotFound(stream, () =>
      client.POST("/library/{libraryId}/live/{streamId}/thumbnail", {
        params: {
          path: { libraryId: library, streamId: stream },
          query: url ? { thumbnailUrl: url } : {},
        },
        ...(bytes
          ? {
              headers: { "Content-Type": "application/octet-stream" },
              bodySerializer: (value: unknown) => value,
              // The generated type for an octet-stream body is `string`; the bytes are what get sent.
              body: bytes as unknown as string,
            }
          : {}),
        signal: ctx.signal,
      }),
    );
    return { id: stream, thumbnail: "set" };
  },
});

export const streamLiveThumbnailRemove = defineTool({
  name: "stream.live.thumbnail.remove",
  title: "Remove a live stream thumbnail",
  description:
    "Remove a live stream's custom thumbnail, falling back to the library's default live thumbnail when `restoreDefault` is set and one exists. The custom image is deleted and can't be restored; set it again to bring it back.",
  schema: z.strictObject({
    library: libraryId,
    stream: streamId,
    restoreDefault: z
      .boolean()
      .default(true)
      .describe(
        "Use the library's default live thumbnail afterwards, if it has one.",
      ),
  }),
  kind: "destructive",
  resultSchema: ThumbnailResultSchema,
  run: async (
    ctx,
    { library, stream, restoreDefault },
  ): Promise<ThumbnailResult> => {
    const client = await liveClient(ctx, library);
    ctx.progress("Removing thumbnail...");
    try {
      await client.DELETE("/library/{libraryId}/live/{streamId}/thumbnail", {
        params: {
          path: { libraryId: library, streamId: stream },
          query: { restoreLibraryDefault: restoreDefault },
        },
        signal: ctx.signal,
      });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
      // 404 means a missing stream or no custom thumbnail; tell them apart.
      await fetchStream(ctx, client, library, stream);
      throw new UserError(
        `Live stream ${stream} has no custom thumbnail to remove.`,
      );
    }
    return { id: stream, thumbnail: "removed" };
  },
});

export const streamLiveStats = defineTool({
  name: "stream.live.stats",
  title: "Get live encoding statistics",
  description:
    "Get a library's live encoding seconds over a time range (14 days by default), split into primary and backup encoders and broken down by stream, codec and resolution.",
  schema: z.strictObject({
    library: libraryId,
    from: isoTime.optional().describe("Start of the range, ISO 8601 UTC."),
    to: isoTime.optional().describe("End of the range, ISO 8601 UTC."),
    hourly: z
      .boolean()
      .default(false)
      .describe(
        "Hourly buckets (ranges within the last 30 days); daily otherwise.",
      ),
    streams: z
      .array(z.string().trim().min(1))
      .max(50)
      .optional()
      .describe("Only these live stream IDs, up to 50."),
  }),
  kind: "read",
  resultSchema: LiveEncodingStatsSchema,
  run: async (
    ctx,
    { library, from, to, hourly, streams },
  ): Promise<LiveEncodingStats> => {
    const client = await liveClient(ctx, library);
    ctx.progress("Fetching live statistics...");
    const { data } = await client.GET(
      "/library/{libraryId}/live/statistics/encoding",
      {
        params: {
          path: { libraryId: library },
          query: {
            dateFrom: from,
            dateTo: to,
            hourly,
            liveStreamGuids: streams,
          },
        },
        signal: ctx.signal,
      },
    );
    return toLiveEncodingStats(library, data);
  },
});

/** Whether a stream has ended, so start, stop and key rotation no longer apply. */
export function isFinished(stream: Pick<LiveStream, "status">): boolean {
  return FINISHED_STATUSES.includes(stream.status);
}
