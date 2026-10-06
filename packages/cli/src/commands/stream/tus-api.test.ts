import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TUS_RESUMABLE, tusSignature, tusUpload } from "./tus-api.ts";

test("tusSignature hashes libraryId + apiKey + expires + videoId in that order", () => {
  expect(tusSignature(4321, "key-abc", 1_700_000_000, "video-guid")).toBe(
    "082ef4f2f1bc9d64124f7d069a4bea07e0f28381adde37dce2a729ec95d49419",
  );
});

// Minimal TUS server that, like bunny.net, 401s any request missing the presigned headers.
function tusTestServer(
  opts: {
    /** Fail one PATCH once the upload reaches this offset, after banking part of it. */
    failPatchAt?: number;
    /** Bank the whole failing chunk instead of half, as if only the response was lost. */
    keepFailedChunk?: boolean;
    /** Answer every PATCH with this status and bank nothing. */
    patchStatus?: number;
    /** Answer every PATCH with a 204 that does not advance the offset. */
    nonAdvancing?: boolean;
  } = {},
) {
  const uploads = new Map<string, { chunks: Uint8Array[]; offset: number }>();
  const creations: Array<Record<string, string>> = [];
  const patchOffsets: number[] = [];
  let failuresLeft = opts.failPatchAt === undefined ? 0 : 1;

  const unauthorized = (request: Request): Response | undefined => {
    const required = [
      "AuthorizationSignature",
      "AuthorizationExpire",
      "VideoId",
      "LibraryId",
    ];
    const missing = required.filter((name) => !request.headers.get(name));
    if (missing.length === 0) return undefined;
    return new Response(`missing ${missing.join(", ")}`, { status: 401 });
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get("Tus-Resumable") !== TUS_RESUMABLE) {
        return new Response("bad version", { status: 412 });
      }
      const refused = unauthorized(request);
      if (refused) return refused;

      if (request.method === "POST" && url.pathname === "/tusupload") {
        // Header names arrive lowercased from the Headers iterator.
        creations.push(Object.fromEntries(request.headers.entries()));
        const id = `up-${uploads.size + 1}`;
        uploads.set(id, { chunks: [], offset: 0 });
        return new Response(null, {
          status: 201,
          headers: { Location: `${url.origin}/tusupload/${id}` },
        });
      }

      const upload = uploads.get(url.pathname.replace("/tusupload/", ""));
      if (!upload) return new Response("no upload", { status: 404 });

      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "Upload-Offset": String(upload.offset) },
        });
      }

      if (request.method !== "PATCH") {
        return new Response("nope", { status: 405 });
      }
      if (
        request.headers.get("Content-Type") !==
        "application/offset+octet-stream"
      ) {
        return new Response("bad content type", { status: 415 });
      }
      const offset = Number(request.headers.get("Upload-Offset"));
      patchOffsets.push(offset);
      const current = { "Upload-Offset": String(upload.offset) };
      if (opts.patchStatus) {
        return new Response(null, {
          status: opts.patchStatus,
          headers: current,
        });
      }
      if (opts.nonAdvancing) {
        return new Response(null, { status: 204, headers: current });
      }
      if (offset !== upload.offset) {
        return new Response("conflict", { status: 409, headers: current });
      }

      const body = new Uint8Array(await request.arrayBuffer());
      if (failuresLeft > 0 && upload.offset >= (opts.failPatchAt ?? 0)) {
        failuresLeft--;
        const kept = opts.keepFailedChunk
          ? body
          : body.slice(0, Math.floor(body.length / 2));
        upload.chunks.push(kept);
        upload.offset += kept.length;
        return new Response("boom", { status: 500 });
      }

      upload.chunks.push(body);
      upload.offset += body.length;
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(upload.offset) },
      });
    },
  });

  return {
    url: `http://localhost:${server.port}/tusupload`,
    stop: () => server.stop(true),
    creations,
    patchOffsets,
    payload: () => Buffer.concat(uploads.get("up-1")?.chunks ?? []).toString(),
  };
}

let dir = "";
let file = "";
let contents = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunny-stream-tus-"));
  file = join(dir, "clip.mp4");
  // 1000 bytes of varied content so a duplicated or dropped chunk shows.
  contents = Array.from({ length: 100 }, (_, i) =>
    `chunk${String(i).padStart(4, "0")}`.padEnd(10, "."),
  ).join("");
  await Bun.write(file, contents);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function upload(url: string, extra: { onProgress?: (n: number) => void } = {}) {
  return tusUpload({
    libraryId: 4321,
    apiKey: "library-key",
    videoId: "video-guid",
    filePath: file,
    size: contents.length,
    title: "clip.mp4",
    endpoint: url,
    chunkSize: 256,
    retryDelayMs: 1,
    expires: 1_700_000_000,
    onProgress: extra.onProgress,
  });
}

test("tusUpload sends every chunk in order and reports progress", async () => {
  const server = tusTestServer();
  const progress: number[] = [];
  try {
    await upload(server.url, { onProgress: (n) => progress.push(n) });

    expect(server.payload()).toBe(contents);
    expect(server.patchOffsets).toEqual([0, 256, 512, 768]);
    expect(progress).toEqual([256, 512, 768, 1000]);
    const creation = server.creations[0] ?? {};
    // The expiry header must be the value that was signed.
    expect(creation.authorizationexpire).toBe("1700000000");
    // An unset filetype is dropped rather than sent as a bare key.
    expect(creation["upload-metadata"]).toBe(
      `title ${Buffer.from("clip.mp4").toString("base64")}`,
    );
  } finally {
    server.stop();
  }
});

test("tusUpload resumes from the server's offset after a failed PATCH", async () => {
  const server = tusTestServer({ failPatchAt: 256 });
  try {
    await upload(server.url);

    expect(server.payload()).toBe(contents);
    // 256 plus the half chunk the server banked before failing.
    expect(server.patchOffsets).toContain(384);
  } finally {
    server.stop();
  }
});

test("tusUpload finishes when the failed final chunk actually landed", async () => {
  const server = tusTestServer({ failPatchAt: 768, keepFailedChunk: true });
  try {
    await upload(server.url);

    expect(server.payload()).toBe(contents);
    expect(server.patchOffsets).toEqual([0, 256, 512, 768]);
  } finally {
    server.stop();
  }
});

test("tusUpload gives up after the retry budget and says where it stopped", async () => {
  const server = tusTestServer({ patchStatus: 409 });
  try {
    await expect(upload(server.url)).rejects.toThrow(
      /stalled at 0 of 1000 bytes after 3 attempts \(HTTP 409\)/,
    );
  } finally {
    server.stop();
  }
});

test("tusUpload stops when a 2xx does not advance the offset", async () => {
  const server = tusTestServer({ nonAdvancing: true });
  try {
    await expect(upload(server.url)).rejects.toThrow(
      /stalled at 0 of 1000 bytes .*did not advance/,
    );
    expect(server.patchOffsets).toHaveLength(3);
  } finally {
    server.stop();
  }
});

test("tusUpload does not retry a non-retryable PATCH failure", async () => {
  const server = tusTestServer({ patchStatus: 410 });
  try {
    await expect(upload(server.url)).rejects.toThrow(
      /failed at 0 of 1000 bytes \(HTTP 410\)/,
    );
    expect(server.patchOffsets).toHaveLength(1);
  } finally {
    server.stop();
  }
});
