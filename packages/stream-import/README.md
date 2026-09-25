# @bunny.net/stream-import

Move a video library into [bunny.net Stream](https://bunny.net/stream/) from Vimeo, AWS S3, Wistia, Mux, Cloudflare Stream, JW Player, or Brightcove.

bunny.net fetches each file straight from the source over a URL, so nothing lands on the machine running the import and its connection is never the bottleneck. This package is the headless engine behind `bunny stream import`; each source ships as its own adapter package (`@bunny.net/stream-import-vimeo` and so on). It never prompts and never prints on its own: progress goes through a logger you supply, state goes through a store you supply, and the results come back as data.

## Install

```bash
bun add @bunny.net/stream-import @bunny.net/stream-import-vimeo
```

Runs on Bun and Node 20.3 or newer.

## Quick start

```ts
import { createStreamClient } from "@bunny.net/openapi-client";
import {
  BunnyStream,
  createFileStateStore,
  DEFAULT_PROCESSING_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
  MigrationService,
  parseSourceConfig,
  resolveSourceConfig,
} from "@bunny.net/stream-import";
import { vimeoSource } from "@bunny.net/stream-import-vimeo";

const logger = { ...console, success: console.log, dim: console.log };
const ctx = { userAgent: "my-app/1.0", requestTimeout: DEFAULT_REQUEST_TIMEOUT, logger };

// Source credentials come from the environment (VIMEO_ACCESS_TOKEN here) or explicit overrides.
const adapter = vimeoSource.createAdapter(
  parseSourceConfig(vimeoSource, resolveSourceConfig(vimeoSource, { env: process.env })),
  ctx,
);
await adapter.validateCredentials();

// The Stream client is authenticated with the destination library's own API key.
const libraryId = 12345;
const bunny = new BunnyStream({
  client: createStreamClient({
    apiKey: process.env.BUNNY_LIBRARY_API_KEY!,
    userAgent: ctx.userAgent,
  }),
  libraryId,
  requestTimeout: DEFAULT_REQUEST_TIMEOUT,
  processingTimeout: DEFAULT_PROCESSING_TIMEOUT,
  logger,
});

const service = new MigrationService({
  adapter,
  bunny,
  store: createFileStateStore(`./state/vimeo-${libraryId}.json`),
  logger,
  libraryId: String(libraryId),
  label: vimeoSource.label,
});

const summary = await service.getSummary(); // what would happen
const state = await service.runMigration({ concurrency: 3 }); // do it
```

`getSummary()` walks the source once and reports how many videos are new versus already imported; `runMigration()` reuses that discovery, so calling both with the same `folderId` costs one pass.

`runMigration()` also takes a `signal`: aborting it starts no new videos, lets a hand-off already talking to Bunny settle and be recorded (so a resume never submits it twice), abandons any encode wait, skips the wait phase, and returns the state saved as `paused` rather than throwing, ready for `resume: true`.

## How an import works

1. **Discover.** The adapter lists folders and videos. Folders become Stream collections with the same name (matched case-insensitively, created when missing). Sources without folders put everything in the library root.
2. **De-duplicate.** Existing Stream videos are indexed by a per-source metaTag (`vimeoId`, `s3Source`, and so on). A video whose tag is already present is skipped, so re-running an import is safe; one whose tagged copy bunny.net failed to fetch or encode is imported again (counted as `failedOnBunny` in the summary).
3. **Fetch.** For each new video the adapter resolves a download URL, the engine checks it against the adapter's host allowlist (HTTPS only by default), and bunny.net is asked to fetch it. The metaTag is written immediately after, and a resumed run re-asserts it for any video interrupted between those two steps. If the fetch request times out, its outcome is unknown, so the next run looks for an untagged video with the same title created after the request and tags it instead of fetching again; when the match is ambiguous (two lost fetches share a title, or two untagged videos fit) those videos are fetched again.
4. **Wait, if asked.** With `wait: true` the engine polls until bunny.net finishes encoding, fails, or the processing timeout elapses, working `concurrency` videos at a time. By default it returns once every video is queued and tagged; `refreshMigrationState(state, bunny)` later pulls Bunny's progress into the saved state without needing the source adapter.

State is persisted through the `StateStore` after every status transition, so an interrupted run resumes with `runMigration({ resume: true })`. A run with failures is marked `failed` rather than `completed` for the same reason. The run status covers the whole journal, so a folder-scoped run stays `in_progress` while other folders' videos are outstanding (a whole-library resume finishes them), and an entry with no Bunny video that the source no longer lists is marked `failed` ("No longer listed at the source") so the run and `status` agree. `createFileStateStore(path)` is the file-backed implementation; it validates what it reads, writes atomically and owner-only, and holds `<path>.lock` for the length of a run so two runs cannot share one state file (`acquireStateLock(path)` takes the same lock for any other writer).

## Sources

Each source is a `SourcePlugin` describing its credentials, whether it has folders, its dedup tag, and how to build its adapter. Every adapter is its own package, so you install only the platforms you import from and the engine never loads an adapter you did not ask for (the S3 adapter alone carries the AWS SDK).

| Source            | Package                               | Folders              | Dedup tag      | Credentials (environment variables)                                                                                                                                                                            |
| ----------------- | ------------------------------------- | -------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vimeo             | `@bunny.net/stream-import-vimeo`      | Projects             | `vimeoId`      | `VIMEO_ACCESS_TOKEN` (scopes `public`, `private`, `video_files`; downloads need a Standard plan or above)                                                                                                      |
| AWS S3            | `@bunny.net/stream-import-s3`         | First-level prefixes | `s3Source`     | `S3_BUCKET`, `AWS_REGION` (or `AWS_DEFAULT_REGION`), optional `S3_PREFIX`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `S3_ENDPOINT` (or `AWS_ENDPOINT_URL_S3`), `S3_PRESIGNED_URL_TTL` |
| Wistia            | `@bunny.net/stream-import-wistia`     | Projects             | `wistiaId`     | `WISTIA_ACCESS_TOKEN`                                                                                                                                                                                          |
| Mux               | `@bunny.net/stream-import-mux`        | none                 | `muxAssetId`   | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`                                                                                                                                                                             |
| Cloudflare Stream | `@bunny.net/stream-import-cloudflare` | none                 | `cfStreamId`   | `CLOUDFLARE_API_TOKEN` (Stream:Edit), `CLOUDFLARE_ACCOUNT_ID`                                                                                                                                                  |
| JW Player         | `@bunny.net/stream-import-jwplayer`   | none                 | `jwPlayerId`   | `JWPLAYER_API_KEY` (v2), `JWPLAYER_SITE_ID`                                                                                                                                                                    |
| Brightcove        | `@bunny.net/stream-import-brightcove` | Folders              | `brightcoveId` | `BRIGHTCOVE_CLIENT_ID`, `BRIGHTCOVE_CLIENT_SECRET` (CMS video read), `BRIGHTCOVE_ACCOUNT_ID`                                                                                                                   |

S3 leaves the AWS keys optional: omit both and the AWS default credential chain applies, but only when the host sets `allowAmbientCredentials: true` on the `SourceContext` it passes to `createAdapter` (hosts leave it off unless they mean to use the machine's own credentials). bunny.net fetches S3 objects through pre-signed URLs, so the IAM policy needs `s3:ListBucket` on the bucket and `s3:GetObject` on the objects. Only keys with a video extension are considered.

`resolveSourceConfig(plugin, { env, overrides })` reads a plugin's fields from the environment with explicit values winning, `describeSource(plugin, env)` reports whether a source is `ready`, `partial`, or `unconfigured` and which fields are missing, and `parseSourceConfig(plugin, values)` validates against the plugin's schema, naming missing fields by their environment variable. `env` is required in both: the engine never reads `process.env` itself, so a host passes exactly the variables it means to expose.

## Writing an adapter

Implement `SourceAdapter` and export a `SourcePlugin`:

```ts
import { z } from "zod";
import { createHttp, type SourceAdapter, type SourcePlugin } from "@bunny.net/stream-import";

export const mySource: SourcePlugin<{ token: string }> = {
  id: "myplatform",
  label: "My Platform",
  dedupTag: "myPlatformId",
  supportsFolders: false,
  credentials: [
    { key: "token", label: "API token", env: "MYPLATFORM_TOKEN", secret: true, required: true },
  ],
  configSchema: z.object({ token: z.string().min(1) }),
  createAdapter: (config, ctx): SourceAdapter => {
    const http = createHttp({
      label: "My Platform",
      baseUrl: "https://api.example.com",
      timeout: ctx.requestTimeout,
      userAgent: ctx.userAgent,
      headers: { Authorization: `Bearer ${config.token}` },
    });
    return {
      id: "myplatform",
      dedupTag: "myPlatformId",
      validateCredentials: () => http.get("/me"),
      listContent: async () => ({
        folders: [],
        videos: new Map(),
        uncategorizedVideos: await listVideos(http),
      }),
      getDownloadInfo: async (id, signal) => ({
        url: await downloadUrl(http, id, signal),
        title: id,
      }),
      validateUrl: (url) => new URL(url).hostname.endsWith(".example.com"),
    };
  },
};
```

`createHttp` is the small fetch wrapper the built-in adapters use: base URL, default headers, basic auth, a per-request timeout, a 429 back-off that honours `Retry-After`, and exponential retries of GETs on 500/502/503/504 and dropped connections. Pass the `signal` the engine hands `getDownloadInfo` through as the request's `signal` so a timed-out or paused video stops its requests and back-offs. Non-2xx responses throw `HttpError`, and `isHttpError(error, 401)` is the idiom for turning one into an actionable `UserError` (re-exported from this package, so an adapter depends on it alone).

`validateUrl` is a security boundary. It is the last check before a URL is handed to the Stream fetch endpoint, so restrict it to the hosts your platform actually serves downloads from.
