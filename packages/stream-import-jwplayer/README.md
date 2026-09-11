# @bunny.net/stream-import-jwplayer

JW Player source adapter for [`@bunny.net/stream-import`](../stream-import#readme), the engine behind `bunny stream import`. It lists the videos on the account and resolves a download URL for each, which bunny.net Stream then fetches directly.

## Install

```bash
bun add @bunny.net/stream-import @bunny.net/stream-import-jwplayer
```

## Usage

```ts
import { parseSourceConfig, resolveSourceConfig } from "@bunny.net/stream-import";
import { jwplayerSource } from "@bunny.net/stream-import-jwplayer";

// Any Logger implementation works; console is enough for a script.
const logger = { ...console, success: console.log, dim: console.log };

// Credentials resolve from the environment; pass `overrides` for explicit values.
const config = parseSourceConfig(jwplayerSource, resolveSourceConfig(jwplayerSource));
const adapter = jwplayerSource.createAdapter(config, {
  userAgent: "my-app/1.0",
  requestTimeout: 30_000,
  logger,
});
await adapter.validateCredentials();
const content = await adapter.listContent();
```

Hand `adapter` to a `MigrationService` from `@bunny.net/stream-import` to run the import; see that package's README for the full flow.

## Credentials

| Setting      | Environment variable |
| ------------ | -------------------- |
| API key (v2) | `JWPLAYER_API_KEY`   |
| Site ID      | `JWPLAYER_SITE_ID`   |

Both are available at dashboard.jwplayer.com.

JW Player has no folders, so every media item is imported uncategorized. The highest-resolution MP4 source wins, read from the Management API and then the public Delivery API. The dedup metaTag is `jwPlayerId`.
