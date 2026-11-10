# Edge Script SDK (`@bunny.net/edgescript-sdk`)

The runtime SDK for the code inside an Edge Script. `bunny scripts` creates, deploys, and configures the script (see `references/scripts.md`); this package is what the script itself imports to receive requests.

Edge Scripting runs Deno, so the handlers use the web-standard `Request` and `Response`, and `fetch` is global.

- Docs: <https://bunny.net/docs/scripting>
- Standalone scripts: <https://bunny.net/docs/scripting/standalone/overview>
- Middleware scripts: <https://bunny.net/docs/scripting/middleware/overview>
- Runtime and limits: <https://bunny.net/docs/scripting/runtime>, <https://bunny.net/docs/scripting/limits>
- Source and more examples: <https://github.com/BunnyWay/edge-script-sdk>

## Install

```bash
bun add @bunny.net/edgescript-sdk
```

Projects scaffolded by `bunny scripts init` already depend on it and bundle to `dist/index.js`. A single-file script that is deployed without a build step imports straight from npm instead:

```ts
import * as BunnySDK from "npm:@bunny.net/edgescript-sdk@0.13.0";
```

## Two script types

The type is chosen when the script is created (`bunny scripts create --type standalone|middleware`) and decides which entry point to call.

| Type         | Entry point                         | Use it for                                                            |
| ------------ | ----------------------------------- | --------------------------------------------------------------------- |
| `standalone` | `BunnySDK.net.http.serve()`         | The script is the origin: APIs, redirects, rendered pages             |
| `middleware` | `BunnySDK.net.http.servePullZone()` | The script sits in front of a pull zone's origin and rewrites traffic |

## Standalone: `serve(handler)`

The handler takes a `Request` and returns a `Response` (or a promise of one).

```ts
import * as BunnySDK from "@bunny.net/edgescript-sdk";

BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  if (request.method === "POST" && url.pathname === "/echo") {
    const body = await request.json();
    return Response.json({ received: body }, { status: 201 });
  }

  return new Response("Not found", { status: 404 });
});
```

Proxying is a `fetch` away:

```ts
import * as BunnySDK from "@bunny.net/edgescript-sdk";

BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const upstream = await fetch(`https://api.example.com${url.pathname}${url.search}`, {
    headers: { accept: "application/json" },
  });

  const response = new Response(upstream.body, upstream);
  response.headers.set("cache-control", "public, max-age=60");
  return response;
});
```

### Running locally

On bunny.net the listener is provided for you, so `serve(handler)` is all the deployed script needs. The same call works locally under Deno or Node; pass a listener first to pick the address:

```ts
BunnySDK.net.http.serve({ port: 8080, hostname: "127.0.0.1" }, (request) => {
  return new Response(`Hello from ${new URL(request.url).pathname}`);
});
```

## Environment variables and secrets

Set them with the CLI, then read them with `node:process` or `Deno.env`:

```bash
bunny scripts env set API_BASE https://api.example.com
bunny scripts env set API_TOKEN secret-value --secret
bunny scripts env pull                                # write them to a local .env
```

```ts
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import process from "node:process";

const apiBase = process.env.API_BASE;
const apiToken = Deno.env.get("API_TOKEN");

BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  return fetch(`${apiBase}${url.pathname}`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
});
```

Variable names are uppercased by `env set`. Use `--secret` for anything sensitive: secrets are encrypted and cannot be read back.

## Middleware: `servePullZone(options)`

Returns a chainable handler with four hooks. `url` is the origin used in local development only; once deployed, requests go to the origin configured on the linked pull zone.

```ts
import * as BunnySDK from "@bunny.net/edgescript-sdk";

BunnySDK.net.http
  .servePullZone({ url: "https://origin.example.com" })
  .onOriginRequest((ctx) => {
    const url = new URL(ctx.request.url);

    // Resolve a Response to answer without contacting the origin.
    if (url.pathname.startsWith("/internal")) {
      return Promise.resolve(new Response("Forbidden", { status: 403 }));
    }

    // Resolve a Request to continue to the origin.
    const request = new Request(ctx.request);
    request.headers.set("x-origin-secret", Deno.env.get("ORIGIN_SECRET") ?? "");
    return Promise.resolve(request);
  })
  .onOriginResponse((ctx) => {
    const response = new Response(ctx.response.body, ctx.response);
    response.headers.set("x-served-by", "edge-script");
    return Promise.resolve(response);
  });
```

| Hook               | Runs                                    | On a cache hit | Needs "Run script before cache" | Returns                 |
| ------------------ | --------------------------------------- | -------------- | ------------------------------- | ----------------------- |
| `onClientRequest`  | Before the cache lookup                 | Yes            | Yes                             | `Request` or `Response` |
| `onOriginRequest`  | Before the request goes to the origin   | No             | No                              | `Request` or `Response` |
| `onOriginResponse` | After the origin responds, before cache | No             | No                              | `Response`              |
| `onClientResponse` | Before the response goes to the client  | Yes            | Yes                             | `Response`              |

Every hook receives `ctx.request`; the two response hooks also receive `ctx.response`. Hooks must return a promise. A request hook is typed `Promise<Request> | Promise<Response>`, so an `async` function that returns a `Request` on one branch and a `Response` on another does not type-check: return `Promise.resolve(...)` from each branch instead.

The client hooks only run when **Run script before cache** is enabled on the pull zone (General > Origin). With it off they are skipped silently. See <https://bunny.net/docs/scripting/before-cache>.

Access control belongs in `onClientRequest`:

```ts
import * as BunnySDK from "@bunny.net/edgescript-sdk";

BunnySDK.net.http
  .servePullZone({ url: "https://origin.example.com" })
  .onClientRequest((ctx) => {
    const token = ctx.request.headers.get("authorization");
    if (token !== `Bearer ${Deno.env.get("ACCESS_TOKEN")}`) {
      return Promise.resolve(new Response("Unauthorized", { status: 401 }));
    }
    return Promise.resolve(ctx.request);
  })
  .onClientResponse((ctx) => {
    const response = new Response(ctx.response.body, ctx.response);
    response.headers.set("x-frame-options", "DENY");
    return Promise.resolve(response);
  });
```

## Pairing with other bunny.net SDKs

- **Bunny Database**: `connect()` from `@bunny.net/database-client` reads the URL and token that Edge Scripting injects. See `references/database-client.md`.
- **Edge Storage**: `@bunny.net/storage-sdk` reads and writes files in a storage zone from inside a script. See `references/storage-sdk.md`.

## Anti-Patterns

- **Calling `serve()` in a middleware script, or `servePullZone()` in a standalone one**: the entry point has to match the script type it was created with.
- **Access checks in `onOriginRequest`**: origin hooks only run on a cache miss, so cached content is served without them. Check in `onClientRequest` with before-cache execution enabled.
- **Using client hooks without enabling "Run script before cache"**: they never run and nothing reports an error.
- **Reading the visitor's hostname from `ctx.request.url` in an origin hook**: that URL is origin-facing. Read the `CDN-Host` request header instead.
- **Hardcoding secrets in the script**: use `bunny scripts env set NAME value --secret`.
- **Hardcoding a listener address in deployed code**: `serve(handler)` with no listener is what runs on bunny.net; keep the `{ port, hostname }` form for local runs.
