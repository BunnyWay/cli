# @bunny.net/stream-import-cloudflare

Cloudflare Stream source adapter for [`@bunny.net/stream-import`](../stream-import#readme), the engine behind `bunny stream import`. It lists the videos on the account and resolves a download URL for each, which bunny.net Stream then fetches directly.

## Install

```bash
bun add @bunny.net/stream-import @bunny.net/stream-import-cloudflare
```

The adapter runs on the `@bunny.net/stream-import` version it depends on, so install a matching minor of the engine alongside it.

## Usage

```ts
import { parseSourceConfig, resolveSourceConfig } from "@bunny.net/stream-import";
import { cloudflareSource } from "@bunny.net/stream-import-cloudflare";

// Any Logger implementation works; console is enough for a script.
const logger = { ...console, success: console.log, dim: console.log };

// Credentials resolve from the environment; pass `overrides` for explicit values.
const config = parseSourceConfig(cloudflareSource, resolveSourceConfig(cloudflareSource));
const adapter = cloudflareSource.createAdapter(config, {
  userAgent: "my-app/1.0",
  requestTimeout: 30_000,
  logger,
});
await adapter.validateCredentials();
const content = await adapter.listContent();
```

Hand `adapter` to a `MigrationService` from `@bunny.net/stream-import` to run the import; see that package's README for the full flow.

## Credentials

| Setting    | Environment variable                            |
| ---------- | ----------------------------------------------- |
| API token  | `CLOUDFLARE_API_TOKEN` (permission Stream:Edit) |
| Account ID | `CLOUDFLARE_ACCOUNT_ID`                         |

Cloudflare Stream has no folders, so every video is imported uncategorized. An MP4 download is generated on demand and polled for up to five minutes before the video is handed to bunny.net; a download Cloudflare fails to generate stops the poll with its reason. Download URLs must be HTTPS on `cloudflarestream.com` or `videodelivery.net` (or a subdomain). Videos with Require Signed URLs turned on are skipped with that as the reason, since Bunny cannot fetch their MP4 without a signed token. The dedup metaTag is `cfStreamId`.

## Disclaimer

This tool is provided as-is under the MIT License. It is not affiliated with, endorsed by, or sponsored by Cloudflare, Inc. "Cloudflare" is a registered trademark of Cloudflare, Inc. Use of the name is purely descriptive.
