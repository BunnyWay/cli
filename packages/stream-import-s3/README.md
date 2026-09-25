# @bunny.net/stream-import-s3

AWS S3 source adapter for [`@bunny.net/stream-import`](../stream-import#readme), the engine behind `bunny stream import`. It lists the video objects in the bucket and pre-signs a download URL for each, which bunny.net Stream then fetches directly.

## Install

```bash
bun add @bunny.net/stream-import @bunny.net/stream-import-s3
```

## Usage

```ts
import { parseSourceConfig, resolveSourceConfig } from "@bunny.net/stream-import";
import { s3Source } from "@bunny.net/stream-import-s3";

// Any Logger implementation works; console is enough for a script.
const logger = { ...console, success: console.log, dim: console.log };

// Credentials resolve from the environment; pass `overrides` for explicit values.
const config = parseSourceConfig(s3Source, resolveSourceConfig(s3Source));
const adapter = s3Source.createAdapter(config, {
  userAgent: "my-app/1.0",
  requestTimeout: 30_000,
  logger,
});
await adapter.validateCredentials();
const content = await adapter.listContent();
```

Hand `adapter` to a `MigrationService` from `@bunny.net/stream-import` to run the import; see that package's README for the full flow.

## Credentials

| Setting                                               | Environment variable                                        |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| Bucket                                                | `S3_BUCKET`                                                 |
| Region                                                | `AWS_REGION` (or `AWS_DEFAULT_REGION`, default `us-east-1`) |
| Key prefix (optional)                                 | `S3_PREFIX`                                                 |
| Access key ID (optional)                              | `AWS_ACCESS_KEY_ID`                                         |
| Secret access key (optional)                          | `AWS_SECRET_ACCESS_KEY`                                     |
| Session token (optional)                              | `AWS_SESSION_TOKEN`                                         |
| Endpoint URL, S3-compatible providers only (optional) | `S3_ENDPOINT` (or `AWS_ENDPOINT_URL_S3`)                    |
| Pre-signed URL lifetime, seconds (optional)           | `S3_PRESIGNED_URL_TTL` (default 21600, max 604800)          |

Leave the keys unset to use the AWS default credential chain. The IAM policy needs `s3:ListBucket` on the bucket and `s3:GetObject` on the objects.

The first level of prefixes below the configured root becomes Stream collections; objects at the root are imported uncategorized. Only keys with a video extension are considered. `--folder` takes a prefix below the root, including a nested one such as `2024/q1`, and lists only that prefix. Each object is handed to bunny.net as a pre-signed `GetObject` URL, and the dedup metaTag is `s3Source`, holding `bucket/key`.

Objects in `GLACIER`, `DEEP_ARCHIVE`, or an Intelligent-Tiering archive tier are skipped until they are restored; `GLACIER_IR` imports normally.

A pre-signed URL made from temporary credentials (an STS or SSO session) stops working when that session expires, whatever `S3_PRESIGNED_URL_TTL` says.

Accepted download hosts: `{bucket}.s3.amazonaws.com`, `{bucket}.s3.{region}.amazonaws.com`, the path-style `s3.amazonaws.com` and `s3.{region}.amazonaws.com`, `{bucket}.s3-accelerate.amazonaws.com`, the dualstack and FIPS variants of each, and the same under `.amazonaws.com.cn`. With a custom endpoint, only that endpoint's host (bare or with the bucket as a subdomain) is accepted.
