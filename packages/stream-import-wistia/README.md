# @bunny.net/stream-import-wistia

Wistia source adapter for [`@bunny.net/stream-import`](../stream-import#readme), the engine behind `bunny stream import`. It lists the videos on the account and resolves a download URL for each, which bunny.net Stream then fetches directly.

## Install

```bash
bun add @bunny.net/stream-import @bunny.net/stream-import-wistia
```

## Usage

```ts
import { parseSourceConfig, resolveSourceConfig } from "@bunny.net/stream-import";
import { wistiaSource } from "@bunny.net/stream-import-wistia";

// Any Logger implementation works; console is enough for a script.
const logger = { ...console, success: console.log, dim: console.log };

// Credentials resolve from the environment; pass `overrides` for explicit values.
const config = parseSourceConfig(wistiaSource, resolveSourceConfig(wistiaSource));
const adapter = wistiaSource.createAdapter(config, {
  userAgent: "my-app/1.0",
  requestTimeout: 30_000,
  logger,
});
await adapter.validateCredentials();
const content = await adapter.listContent();
```

Hand `adapter` to a `MigrationService` from `@bunny.net/stream-import` to run the import; see that package's README for the full flow.

## Credentials

| Setting   | Environment variable  |
| --------- | --------------------- |
| API token | `WISTIA_ACCESS_TOKEN` |

Create the token under Account > API Access in Wistia.

Wistia projects become Stream collections. The best MP4 rendition wins (HD, then MD, then SD, then the original file). The dedup metaTag is `wistiaId`, holding the media `hashed_id`.
