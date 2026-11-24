# Edge Storage SDK (`@bunny.net/storage-sdk`)

The TypeScript client for reading and writing files in a storage zone from application code. `bunny storage` provisions the zone and moves files from a terminal (see `references/storage.md`); this package is what your app or Edge Script uses at runtime.

It talks to the Edge Storage HTTP API with `fetch` and web streams, so the same code runs on Bunny Edge Scripting (Deno), Bun, and Node.

- Docs: <https://bunny.net/docs/storage/typescript-sdk>
- HTTP API it wraps: <https://bunny.net/docs/storage/http>
- Source and more examples: <https://github.com/BunnyWay/edge-script-sdk>

## Critical: server-side only

**Never ship the zone password to a browser or any other untrusted client.** It is a bearer credential for the whole zone: anything holding it can read, overwrite, and delete every file. The read-only password narrows that to reading every file, which is still the whole zone.

Keep it on a server or in an Edge Script secret, and serve public files through the zone's pull zone rather than through this SDK.

## Install

```bash
bun add @bunny.net/storage-sdk
```

## Credentials

Connecting takes the zone name, the zone password, and the zone's main region. The CLI writes all three to `.env`:

```bash
bunny storage zones credentials my-zone --connection http --save-env
bunny storage zones credentials my-zone --format sdk   # print a connect snippet with the right region
```

That saves `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`, and `BUNNY_STORAGE_REGION`. Add `--read-only` to save the read-only password when the code never writes.

For an Edge Script, set them on the script instead:

```bash
bunny scripts env set BUNNY_STORAGE_ZONE my-zone
bunny scripts env set BUNNY_STORAGE_PASSWORD <zone-password> --secret
```

## Connecting

```ts
import * as BunnyStorageSDK from "@bunny.net/storage-sdk";

const sz = BunnyStorageSDK.zone.connect_with_accesskey(
  BunnyStorageSDK.regions.StorageRegion.Falkenstein,
  process.env.BUNNY_STORAGE_ZONE!,
  process.env.BUNNY_STORAGE_PASSWORD!,
);
```

`connect_with_accesskey()` does no I/O, so build the zone once at module scope and reuse it.

The region must be the zone's **main** region (`bunny storage zones show my-zone`):

| `StorageRegion` member | Value | CLI region code |
| ---------------------- | ----- | --------------- |
| `Falkenstein`          | `de`  | `DE`            |
| `London`               | `uk`  | `UK`            |
| `NewYork`              | `ny`  | `NY`            |
| `LosAngeles`           | `la`  | `LA`            |
| `Singapore`            | `sg`  | `SG`            |
| `Stockholm`            | `se`  | `SE`            |
| `SaoPaulo`             | `br`  | `BR`            |
| `Johannesburg`         | `jh`  | `JH`            |
| `Sydney`               | `syd` | `SYD`           |

`BUNNY_STORAGE_REGION` holds the lowercase value, so it can stand in for the enum member:

```ts
const region = process.env.BUNNY_STORAGE_REGION as BunnyStorageSDK.regions.StorageRegion;
const sz = BunnyStorageSDK.zone.connect_with_accesskey(
  region,
  process.env.BUNNY_STORAGE_ZONE!,
  process.env.BUNNY_STORAGE_PASSWORD!,
);
```

## Files

Paths are relative to the zone root and start with `/`.

### List a directory

```ts
const files = await BunnyStorageSDK.file.list(sz, "/images");

for (const file of files) {
  console.log(file.isDirectory ? "dir " : "file", file.objectName, file.length);
}
```

### Upload

`upload()` takes a `ReadableStream<Uint8Array>`, so a file never has to be held in memory.

```ts
// From a string or bytes
await BunnyStorageSDK.file.upload(sz, "/notes/hello.txt", new Blob(["Hello, bunny!"]).stream(), {
  contentType: "text/plain",
});

// From a local file (Bun)
await BunnyStorageSDK.file.upload(sz, "/images/photo.png", Bun.file("./photo.png").stream(), {
  contentType: "image/png",
});

// From an incoming request body
await BunnyStorageSDK.file.upload(sz, "/uploads/report.pdf", request.body!, {
  contentType: request.headers.get("content-type") ?? undefined,
});
```

| Option           | Description                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| `contentType`    | Content type to store the file as                                          |
| `sha256Checksum` | SHA256 of the data, verified by the server (calculated for you if omitted) |

Missing parent directories are created by the upload. There is no per-file cache header: cache policy lives on the pull zone.

### Download

```ts
const { stream, response, length } = await BunnyStorageSDK.file.download(sz, "/images/photo.png");

// Stream it straight back out of a handler
return new Response(stream, {
  headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" },
});

// Or read it all
const text = await new Response(stream).text();
```

### Metadata

```ts
const file = await BunnyStorageSDK.file.get(sz, "/images/photo.png");

file.objectName; // "photo.png"
file.length; // size in bytes
file.contentType; // "image/png"
file.lastChanged; // Date
file.checksum; // SHA256, or null

const { stream } = await file.data(); // same as download()
```

Every entry from `list()` has the same shape: `guid`, `path`, `objectName`, `length`, `isDirectory`, `contentType`, `checksum`, `lastChanged`, `dateCreated`, `replicatedZones`, `storageZoneName`, and `data()`.

### Remove and create directories

```ts
await BunnyStorageSDK.file.remove(sz, "/images/photo.png");
await BunnyStorageSDK.file.removeDirectory(sz, "/images"); // recursive
await BunnyStorageSDK.file.createDirectory(sz, "/archive");
```

## Errors

The functions do not fail the same way, so check the right thing:

| Function                                       | On failure                                              |
| ---------------------------------------------- | ------------------------------------------------------- |
| `list`, `get`, `download`, `upload`            | Throws an `Error` (for example `File not found: /path`) |
| `remove`, `removeDirectory`, `createDirectory` | Resolves to `false`                                     |

```ts
const removed = await BunnyStorageSDK.file.remove(sz, "/images/photo.png");
if (!removed) throw new Error("Could not remove /images/photo.png");
```

## In an Edge Script

A standalone script that serves private files from a zone after checking a token. The password stays in the script's secrets and the caller only gets the bytes.

```ts
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import * as BunnyStorageSDK from "@bunny.net/storage-sdk";
import process from "node:process";

const sz = BunnyStorageSDK.zone.connect_with_accesskey(
  BunnyStorageSDK.regions.StorageRegion.Falkenstein,
  process.env.BUNNY_STORAGE_ZONE!,
  process.env.BUNNY_STORAGE_PASSWORD!,
);

BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
  if (request.headers.get("authorization") !== `Bearer ${process.env.DOWNLOAD_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { pathname } = new URL(request.url);

  try {
    const { stream, response } = await BunnyStorageSDK.file.download(sz, `/private${pathname}`);
    return new Response(stream, {
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      },
    });
  } catch (error) {
    console.error(error);
    return new Response("Not found", { status: 404 });
  }
});
```

See `references/edge-script-sdk.md` for the script side and `references/scripts.md` for deploying it.

## Anti-Patterns

- **Any browser or client-side use.** See the warning at the top: the password covers the whole zone.
- **Serving public assets through the SDK.** Put a pull zone in front of the zone (`bunny storage zones create --pull-zone`) and let the CDN serve and cache them.
- **Connecting with a replication region.** Use the zone's main region.
- **Assuming `remove()` throws.** It resolves to `false`; check the result.
- **Buffering uploads into memory.** Pass a stream (`request.body`, `Bun.file().stream()`).
- **Hardcoding the password.** Read it from the environment; `--format sdk` emits a snippet that already does.
- **Returning a caught error to a caller.** The message includes the zone path; log it and return something generic.
