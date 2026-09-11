# @bunny.net/stream-import-mux

Mux source adapter for [`@bunny.net/stream-import`](../stream-import#readme), the engine behind `bunny stream import`. It lists the videos on the account and resolves a download URL for each, which bunny.net Stream then fetches directly.

## Install

```bash
bun add @bunny.net/stream-import @bunny.net/stream-import-mux
```

## Usage

```ts
import { parseSourceConfig, resolveSourceConfig } from "@bunny.net/stream-import";
import { muxSource } from "@bunny.net/stream-import-mux";

// Any Logger implementation works; console is enough for a script.
const logger = { ...console, success: console.log, dim: console.log };

// Credentials resolve from the environment; pass `overrides` for explicit values.
const config = parseSourceConfig(muxSource, resolveSourceConfig(muxSource));
const adapter = muxSource.createAdapter(config, {
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
| Token ID     | `MUX_TOKEN_ID`       |
| Token secret | `MUX_TOKEN_SECRET`   |

Create an access token at dashboard.mux.com/settings/api-keys.

Mux has no folders, so every asset is imported uncategorized. Downloads come from static MP4 renditions (or temporary master access), so an asset needs MP4 support enabled. The dedup metaTag is `muxAssetId`.
