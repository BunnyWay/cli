# @bunny.net/stream-import-brightcove

Brightcove source adapter for [`@bunny.net/stream-import`](../stream-import#readme), the engine behind `bunny stream import`. It lists the videos on the account and resolves a download URL for each, which bunny.net Stream then fetches directly.

## Install

```bash
bun add @bunny.net/stream-import @bunny.net/stream-import-brightcove
```

The adapter runs on the `@bunny.net/stream-import` version it depends on, so install a matching minor of the engine alongside it.

## Usage

```ts
import { parseSourceConfig, resolveSourceConfig } from "@bunny.net/stream-import";
import { brightcoveSource } from "@bunny.net/stream-import-brightcove";

// Any Logger implementation works; console is enough for a script.
const logger = { ...console, success: console.log, dim: console.log };

// Credentials resolve from the environment; pass `overrides` for explicit values.
const config = parseSourceConfig(brightcoveSource, resolveSourceConfig(brightcoveSource));
const adapter = brightcoveSource.createAdapter(config, {
  userAgent: "my-app/1.0",
  requestTimeout: 30_000,
  logger,
});
await adapter.validateCredentials();
const content = await adapter.listContent();
```

Hand `adapter` to a `MigrationService` from `@bunny.net/stream-import` to run the import; see that package's README for the full flow.

## Credentials

| Setting       | Environment variable       |
| ------------- | -------------------------- |
| Client ID     | `BRIGHTCOVE_CLIENT_ID`     |
| Client secret | `BRIGHTCOVE_CLIENT_SECRET` |
| Account ID    | `BRIGHTCOVE_ACCOUNT_ID`    |

Create an OAuth client at studio.brightcove.com/admin/oauthclient with CMS video read permissions.

Brightcove folders become Stream collections. The highest-resolution HTTPS MP4 rendition wins; a video without one fails with that as the reason, since the digital master endpoint exposes no download URL. Download URLs only need to be HTTPS: renditions are served from whichever CDN the account's delivery profile uses, so there is no fixed host to allow. The dedup metaTag is `brightcoveId`.

## Disclaimer

This tool is provided as-is under the MIT License. It is not affiliated with, endorsed by, or sponsored by Brightcove Inc. "Brightcove" is a registered trademark of Brightcove Inc. Use of the name is purely descriptive.
