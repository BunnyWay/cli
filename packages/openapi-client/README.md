# @bunny.net/openapi-client

Standalone, type-safe OpenAPI client for [bunny.net](https://bunny.net). Zero CLI dependencies. Built on `openapi-fetch` with types generated from bunny.net's OpenAPI specs.

## Installation

```bash
bun add @bunny.net/openapi-client
```

## Usage

```typescript
import { createCoreClient } from "@bunny.net/openapi-client";

const client = createCoreClient({
  apiKey: "bny_xxxxxxxxxxxx",
});

const { data } = await client.GET("/pullzone");
console.log(data?.Items);
```

## Clients

Each client is scoped to a specific bunny.net API domain:

| Client           | Factory                      | Base URL                               |
| ---------------- | ---------------------------- | -------------------------------------- |
| Core API         | `createCoreClient()`         | `https://api.bunny.net`                |
| Edge Scripting   | `createComputeClient()`      | `https://api.bunny.net`                |
| Database         | `createDbClient()`           | `https://api.bunny.net/database`       |
| Magic Containers | `createMcClient()`           | `https://api.bunny.net/mc`             |
| Origin Errors    | `createOriginErrorsClient()` | `https://cdn-origin-logging.bunny.net` |
| Shield           | `createShieldClient()`       | `https://api.bunny.net`                |
| Storage          | `createStorageClient()`      | `https://storage.bunnycdn.com`         |
| Stream           | `createStreamClient()`       | `https://video.bunnycdn.com`           |

> **Storage** is region-specific — pass `baseUrl` (e.g. `https://la.storage.bunnycdn.com`) to target a non-default region. The `apiKey` should be the Storage Zone password.
>
> **Stream** expects a per-library Stream API key as `apiKey`, not the account-wide key.

All clients accept a `ClientOptions` object:

```typescript
interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  verbose?: boolean;
  userAgent?: string;
  onDebug?: (msg: string) => void;
}
```

## Error Handling

Non-OK responses are automatically converted to `ApiError` by the built-in middleware. You never need to check status codes manually.

```typescript
import { ApiError, UserError } from "@bunny.net/openapi-client";

try {
  await client.GET("/pullzone/{id}", {
    params: { path: { id: 999 } },
  });
} catch (err) {
  if (err instanceof ApiError) {
    console.error(err.message, err.status);
  }
}
```

- `UserError` — expected errors (bad input, missing config). Has an optional `hint` property.
- `ApiError` — extends `UserError`. Carries `status`, optional `field`, and optional `validationErrors[]`.

## Generated Types

TypeScript types are generated from OpenAPI specs via `openapi-typescript`. Access them through the `generated` export:

```typescript
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";

type PullZone = components["schemas"]["PullZone"];
```

Available type modules:

- `@bunny.net/openapi-client/generated/core.d.ts`
- `@bunny.net/openapi-client/generated/compute.d.ts`
- `@bunny.net/openapi-client/generated/database.d.ts`
- `@bunny.net/openapi-client/generated/magic-containers.d.ts`
- `@bunny.net/openapi-client/generated/origin-errors.d.ts`
- `@bunny.net/openapi-client/generated/shield.d.ts`
- `@bunny.net/openapi-client/generated/storage.d.ts`
- `@bunny.net/openapi-client/generated/stream.d.ts`

## Updating Specs

```bash
cd packages/openapi-client
bun run update-specs    # Downloads latest specs + regenerates types
bun run generate        # Regenerate types from existing specs
```
