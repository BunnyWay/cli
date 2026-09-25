# @bunny.net/stream-import-mux

Mux source adapter for [`@bunny.net/stream-import`](../stream-import#readme), the engine behind `bunny stream import`. It lists the videos on the account and resolves a download URL for each, which bunny.net Stream then fetches directly.

## Install

```bash
bun add @bunny.net/stream-import @bunny.net/stream-import-mux
```

The adapter runs on the `@bunny.net/stream-import` version it depends on, so install a matching minor of the engine alongside it.

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

Mux has no folders, so every asset is imported uncategorized. The master (original) file is preferred when temporary master access is enabled and ready; otherwise the best static MP4 rendition the asset reports as ready is used (`highest.mp4`, then resolution renditions, then the deprecated `high`/`medium`/`low` names), on a public playback ID. An asset with neither is skipped, so enable master access or static renditions before importing, and audio-only assets are always skipped. Download URLs must be HTTPS on a `mux.com` subdomain. Titles come from `meta.title`, falling back to `passthrough`. The dedup metaTag is `muxAssetId`.

## Disclaimer

This tool is provided as-is under the MIT License. It is not affiliated with, endorsed by, or sponsored by Mux, Inc. "Mux" is a registered trademark of Mux, Inc. Use of the name is purely descriptive.
