# @bunny.net/openapi-client

Standalone, type-safe OpenAPI client for [bunny.net](https://bunny.net). Zero CLI dependencies. Built on `openapi-fetch` with types generated from bunny.net's OpenAPI specs.

## Installation

```bash
bun add @bunny.net/openapi-client
# or
npm install @bunny.net/openapi-client
```

Requires a runtime with a global `fetch` (Node.js ≥ 18, Bun, Deno, edge runtimes). ESM-only.

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

## Per-API Entrypoints

Each API also has its own subpath entrypoint exporting the client factory together with every type generated from that API's OpenAPI spec (`paths`, `components`, `operations`):

```typescript
import { createCoreClient } from "@bunny.net/openapi-client/core";
import type { components } from "@bunny.net/openapi-client/core";

type DnsZone = components["schemas"]["DnsZoneModel"];
```

| Entrypoint                                   | Exports                                              |
| -------------------------------------------- | ---------------------------------------------------- |
| `@bunny.net/openapi-client/core`             | `createCoreClient`, core spec types, DNS scan types  |
| `@bunny.net/openapi-client/compute`          | `createComputeClient`, compute spec types            |
| `@bunny.net/openapi-client/database`         | `createDbClient`, database spec types                |
| `@bunny.net/openapi-client/magic-containers` | `createMcClient`, Magic Containers spec types        |
| `@bunny.net/openapi-client/origin-errors`    | `createOriginErrorsClient`, origin-errors spec types |
| `@bunny.net/openapi-client/shield`           | `createShieldClient`, shield spec types              |
| `@bunny.net/openapi-client/storage`          | `createStorageClient`, storage spec types            |
| `@bunny.net/openapi-client/stream`           | `createStreamClient`, stream spec types              |

The raw generated modules remain available at `@bunny.net/openapi-client/generated/<spec>.d.ts` for backwards compatibility.

## Custom Clients

The shared middleware — auth-header injection, debug logging, and error normalization — is exported as `authMiddleware`, so you can compose your own `openapi-fetch` client (for example, over a spec of your own or with extra middleware) and keep the same behavior:

```typescript
import createClient from "openapi-fetch";
import { authMiddleware } from "@bunny.net/openapi-client";
import type { paths } from "@bunny.net/openapi-client/core";

const client = createClient<paths>({ baseUrl: "https://api.bunny.net" });
client.use(authMiddleware({ apiKey: "bny_xxxxxxxxxxxx" }));
client.use(myLoggingMiddleware);
```

## Updating Specs

```bash
cd packages/openapi-client
bun run update-specs    # Downloads latest specs + regenerates types
bun run generate        # Regenerate types from existing specs
```
