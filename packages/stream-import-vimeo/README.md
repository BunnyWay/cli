# @bunny.net/stream-import-vimeo

Vimeo source adapter for [`@bunny.net/stream-import`](../stream-import#readme), the engine behind `bunny stream import`. It lists the videos on the account and resolves a download URL for each, which bunny.net Stream then fetches directly.

## Install

```bash
bun add @bunny.net/stream-import @bunny.net/stream-import-vimeo
```

## Usage

```ts
import { parseSourceConfig, resolveSourceConfig } from "@bunny.net/stream-import";
import { vimeoSource } from "@bunny.net/stream-import-vimeo";

// Any Logger implementation works; console is enough for a script.
const logger = { ...console, success: console.log, dim: console.log };

// Credentials resolve from the environment; pass `overrides` for explicit values.
const config = parseSourceConfig(vimeoSource, resolveSourceConfig(vimeoSource));
const adapter = vimeoSource.createAdapter(config, {
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
| Access token | `VIMEO_ACCESS_TOKEN` |

Create the token at developer.vimeo.com/apps with the `public`, `private`, and `video_files` scopes. Download links are only exposed on a Standard plan or above; on lower tiers the adapter falls back to the highest-resolution streaming file.

Vimeo projects become Stream collections. The dedup metaTag is `vimeoId`, holding the numeric video ID. Download URLs are checked against the Vimeo CDN host allowlist before they reach bunny.net.
