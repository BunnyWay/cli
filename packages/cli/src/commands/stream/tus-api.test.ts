import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TUS_RESUMABLE,
  tusExpiration,
  tusMetadata,
  tusSignature,
  tusUpload,
} from "./tus-api.ts";

test("tusSignature hashes libraryId + apiKey + expires + videoId", () => {
  // Vector computed independently of the implementation's string building:
  // sha256("4321" + "key-abc" + "1700000000" + "video-guid").
  const expected = new Bun.CryptoHasher("sha256")
    .update("4321key-abc1700000000video-guid")
    .digest("hex");

  expect(tusSignature(4321, "key-abc", 1_700_000_000, "video-guid")).toBe(
    expected,
  );
  // Hex SHA-256, so exactly 64 lowercase hex characters.
  expect(expected).toMatch(/^[0-9a-f]{64}$/);
});

// The expiration is signed material, so a changed value invalidates the signature.
test("tusSignature changes with every input", () => {
  const base = tusSignature(1, "k", 100, "v");
  expect(tusSignature(2, "k", 100, "v")).not.toBe(base);
  expect(tusSignature(1, "k2", 100, "v")).not.toBe(base);
  expect(tusSignature(1, "k", 101, "v")).not.toBe(base);
  expect(tusSignature(1, "k", 100, "v2")).not.toBe(base);
  expect(base).toHaveLength(64);
});

test("tusExpiration returns unix seconds in the future", () => {
  expect(tusExpiration(1_700_000_000_000, 3600)).toBe(1_700_003_600);
});

test("tusMetadata base64-encodes values and drops empty ones", () => {
  expect(tusMetadata({ title: "clip.mp4", filetype: "video/mp4" })).toBe(
    `title ${Buffer.from("clip.mp4").toString("base64")},filetype ${Buffer.from("video/mp4").toString("base64")}`,
  );
  expect(tusMetadata({ title: "a", filetype: undefined })).toBe(
    `title ${Buffer.from("a").toString("base64")}`,
  );
  expect(tusMetadata({ title: "a", filetype: "" })).toBe(
    `title ${Buffer.from("a").toString("base64")}`,
  );
});

/**
 * Minimal TUS server: creation hands back a Location, PATCH appends at the
 * offset it is told, and HEAD reports what it actually holds. It assembles the
 * payload so a test can check the bytes it received end to end.
 */
function tusTestServer(opts: { failPatchAt?: number } = {}) {
  const uploads = new Map<string, { chunks: Uint8Array[]; offset: number }>();
  // Header snapshots rather than the requests themselves: Bun's Request type and
  // the ambient DOM one are not interchangeable under tsc.
  const creations: Array<Record<string, string>> = [];
  const patchHeaders: Array<Record<string, string>> = [];
  const authSeenOn: string[] = [];
  let failuresLeft = opts.failPatchAt === undefined ? 0 : 1;

  /**
   * bunny.net authenticates every request in the upload, so the fake does too:
   * a request missing any of the four presigned headers is a 401, whatever the
   * method. This is what keeps the client from regressing to creation-only auth.
   */
  const unauthorized = (request: Request): Response | undefined => {
    const required = [
      "AuthorizationSignature",
      "AuthorizationExpire",
      "VideoId",
      "LibraryId",
    ];
    const missing = required.filter((name) => !request.headers.get(name));
    if (missing.length > 0) {
      return new Response(`missing ${missing.join(", ")}`, { status: 401 });
    }
    authSeenOn.push(request.method);
    return undefined;
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/tusupload") {
        // Header names arrive lowercased from the Headers iterator.
        creations.push(Object.fromEntries(request.headers.entries()));
        if (request.headers.get("Tus-Resumable") !== TUS_RESUMABLE) {
          return new Response("bad version", { status: 412 });
        }
        const refused = unauthorized(request);
        if (refused) return refused;
        const id = `up-${uploads.size + 1}`;
        uploads.set(id, { chunks: [], offset: 0 });
        return new Response(null, {
          status: 201,
          headers: {
            Location: `${url.origin}/tusupload/${id}`,
            "Tus-Resumable": TUS_RESUMABLE,
          },
        });
      }

      const id = url.pathname.replace("/tusupload/", "");
      const upload = uploads.get(id);
      if (!upload) return new Response("no upload", { status: 404 });

      if (request.method === "HEAD") {
        const refused = unauthorized(request);
        if (refused) return refused;
        return new Response(null, {
          status: 200,
          headers: {
            "Upload-Offset": String(upload.offset),
            "Tus-Resumable": TUS_RESUMABLE,
          },
        });
      }

      if (request.method === "PATCH") {
        patchHeaders.push({
          resumable: request.headers.get("Tus-Resumable") ?? "",
          offset: request.headers.get("Upload-Offset") ?? "",
          contentType: request.headers.get("Content-Type") ?? "",
          signature: request.headers.get("AuthorizationSignature") ?? "",
        });
        if (request.headers.get("Tus-Resumable") !== TUS_RESUMABLE) {
          return new Response("bad version", { status: 412 });
        }
        const refused = unauthorized(request);
        if (refused) return refused;
        if (
          request.headers.get("Content-Type") !==
          "application/offset+octet-stream"
        ) {
          return new Response("bad content type", { status: 415 });
        }
        const offset = Number(request.headers.get("Upload-Offset"));
        if (offset !== upload.offset) {
          // TUS offset conflict, which the client resolves with a HEAD.
          return new Response("conflict", {
            status: 409,
            headers: { "Upload-Offset": String(upload.offset) },
          });
        }

        const body = new Uint8Array(await request.arrayBuffer());

        // Simulate a transient failure once, after banking part of the chunk so
        // the client cannot guess the offset and must ask.
        if (failuresLeft > 0 && upload.offset >= (opts.failPatchAt ?? 0)) {
          failuresLeft--;
          const kept = body.slice(0, Math.floor(body.length / 2));
          upload.chunks.push(kept);
          upload.offset += kept.length;
          return new Response("boom", { status: 500 });
        }

        upload.chunks.push(body);
        upload.offset += body.length;
        return new Response(null, {
          status: 204,
          headers: {
            "Upload-Offset": String(upload.offset),
            "Tus-Resumable": TUS_RESUMABLE,
          },
        });
      }

      return new Response("nope", { status: 405 });
    },
  });

  return {
    url: `http://localhost:${server.port}/tusupload`,
    stop: () => server.stop(true),
    creations,
    patchHeaders,
    authSeenOn,
    payload: () => {
      const upload = uploads.get("up-1");
      if (!upload) return new Uint8Array();
      const total = upload.chunks.reduce((sum, c) => sum + c.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const chunk of upload.chunks) {
        out.set(chunk, at);
        at += chunk.length;
      }
      return out;
    },
    offset: () => uploads.get("up-1")?.offset ?? 0,
  };
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

let dir = "";
let file = "";
let contents = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunny-stream-tus-"));
  file = join(dir, "clip.mp4");
  // 1000 bytes of varied content so a duplicated or dropped chunk changes the hash.
  contents = Array.from({ length: 100 }, (_, i) =>
    `chunk${String(i).padStart(4, "0")}`.padEnd(10, "."),
  ).join("");
  await Bun.write(file, contents);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("tusUpload sends every chunk and reports progress", async () => {
  const server = tusTestServer();
  const progress: Array<[number, number]> = [];
  try {
    await tusUpload({
      libraryId: 4321,
      apiKey: "library-key",
      videoId: "video-guid",
      filePath: file,
      size: contents.length,
      title: "clip.mp4",
      filetype: "video/mp4",
      endpoint: server.url,
      chunkSize: 256,
      onProgress: (uploaded, total) => progress.push([uploaded, total]),
    });

    // The bytes on the server are exactly the file, in order.
    expect(sha256(server.payload())).toBe(
      sha256(new Uint8Array(Buffer.from(contents))),
    );
    expect(server.offset()).toBe(contents.length);

    // 1000 bytes in 256-byte chunks: four PATCHes, four progress reports.
    expect(server.patchHeaders).toHaveLength(4);
    expect(progress.map(([uploaded]) => uploaded)).toEqual([
      256, 512, 768, 1000,
    ]);
    expect(progress.every(([, total]) => total === contents.length)).toBe(true);

    // Every PATCH carries the protocol headers the server validates.
    for (const headers of server.patchHeaders) {
      expect(headers.resumable).toBe(TUS_RESUMABLE);
      expect(headers.contentType).toBe("application/offset+octet-stream");
    }
    expect(server.patchHeaders.map((h) => h.offset)).toEqual([
      "0",
      "256",
      "512",
      "768",
    ]);
  } finally {
    server.stop();
  }
});

// bunny.net authenticates each TUS request, so creation-only auth 401s the PATCHes.
test("tusUpload signs every request, not just the creation", async () => {
  const server = tusTestServer({ failPatchAt: 256 });
  try {
    await tusUpload({
      libraryId: 4321,
      apiKey: "library-key",
      videoId: "video-guid",
      filePath: file,
      size: contents.length,
      title: "clip.mp4",
      endpoint: server.url,
      chunkSize: 256,
      retryDelayMs: 1,
      expires: 1_700_000_000,
    });

    const expected = tusSignature(
      4321,
      "library-key",
      1_700_000_000,
      "video-guid",
    );
    // Every PATCH carried the same signature as the creation.
    expect(server.patchHeaders.length).toBeGreaterThan(1);
    for (const headers of server.patchHeaders) {
      expect(headers.signature).toBe(expected);
    }
    // And the resume HEAD was authenticated too, or the fake would have 401ed.
    expect(server.authSeenOn).toContain("POST");
    expect(server.authSeenOn).toContain("PATCH");
    expect(server.authSeenOn).toContain("HEAD");
  } finally {
    server.stop();
  }
});

test("tusUpload signs the creation request with the library key", async () => {
  const server = tusTestServer();
  try {
    await tusUpload({
      libraryId: 4321,
      apiKey: "library-key",
      videoId: "video-guid",
      filePath: file,
      size: contents.length,
      title: "clip.mp4",
      endpoint: server.url,
      chunkSize: 1024,
      expires: 1_700_000_000,
    });

    const creation = server.creations[0] ?? {};
    expect(creation.authorizationsignature).toBe(
      tusSignature(4321, "library-key", 1_700_000_000, "video-guid"),
    );
    expect(creation.authorizationexpire).toBe("1700000000");
    expect(creation.videoid).toBe("video-guid");
    expect(creation.libraryid).toBe("4321");
    expect(creation["upload-length"]).toBe(String(contents.length));
    expect(creation["tus-resumable"]).toBe(TUS_RESUMABLE);
    // The API key itself is never sent as a header, only its signature.
    expect(creation.accesskey).toBeUndefined();
    expect(JSON.stringify(creation)).not.toContain("library-key");
    expect(creation["upload-metadata"] ?? "").toContain(
      Buffer.from("clip.mp4").toString("base64"),
    );
  } finally {
    server.stop();
  }
});

// The integrity claim: after a failure that banked half a chunk, the client must
// resume from the server's real offset, so the assembled bytes still hash equal.
test("tusUpload resumes from the server's offset after a failed PATCH", async () => {
  const server = tusTestServer({ failPatchAt: 256 });
  const progress: number[] = [];
  try {
    await tusUpload({
      libraryId: 4321,
      apiKey: "library-key",
      videoId: "video-guid",
      filePath: file,
      size: contents.length,
      title: "clip.mp4",
      endpoint: server.url,
      chunkSize: 256,
      retryDelayMs: 1,
      onProgress: (uploaded) => progress.push(uploaded),
    });

    // No bytes duplicated and none lost, despite the mid-chunk failure.
    expect(server.offset()).toBe(contents.length);
    expect(sha256(server.payload())).toBe(
      sha256(new Uint8Array(Buffer.from(contents))),
    );
    expect(Buffer.from(server.payload()).toString()).toBe(contents);

    // The retry resumed at 384 (256 + half of the failed chunk), not at 256.
    const offsets = server.patchHeaders.map((h) => Number(h.offset));
    expect(offsets).toContain(384);
    expect(progress.at(-1)).toBe(contents.length);
  } finally {
    server.stop();
  }
});

test("tusUpload gives up after the retry budget and says where it stopped", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST") {
        return new Response(null, {
          status: 201,
          headers: { Location: `${url.origin}/tusupload/up-1` },
        });
      }
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "Upload-Offset": "0" },
        });
      }
      return new Response("boom", { status: 500 });
    },
  });
  try {
    await expect(
      tusUpload({
        libraryId: 4321,
        apiKey: "k",
        videoId: "v",
        filePath: file,
        size: contents.length,
        title: "clip.mp4",
        endpoint: `http://localhost:${server.port}/tusupload`,
        chunkSize: 256,
        retryDelayMs: 1,
      }),
    ).rejects.toThrow(/stalled at 0 of 1000 bytes after 3 attempts/);
  } finally {
    server.stop(true);
  }
});

test("tusUpload surfaces a refused creation as a user-facing error", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("nope", { status: 401 }),
  });
  try {
    await expect(
      tusUpload({
        libraryId: 4321,
        apiKey: "k",
        videoId: "v",
        filePath: file,
        size: contents.length,
        title: "clip.mp4",
        endpoint: `http://localhost:${server.port}/tusupload`,
      }),
    ).rejects.toThrow(/The resumable upload was refused \(HTTP 401\)/);
  } finally {
    server.stop(true);
  }
});

test("tusUpload fails fast when creation returns no upload URL", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(null, { status: 201 }),
  });
  try {
    await expect(
      tusUpload({
        libraryId: 4321,
        apiKey: "k",
        videoId: "v",
        filePath: file,
        size: contents.length,
        title: "clip.mp4",
        endpoint: `http://localhost:${server.port}/tusupload`,
      }),
    ).rejects.toThrow(/without an upload URL/);
  } finally {
    server.stop(true);
  }
});

// A 4xx other than a conflict will fail the same way forever, so retrying it
// only delays the error.
test("tusUpload does not retry a non-retryable PATCH failure", async () => {
  let patches = 0;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST") {
        return new Response(null, {
          status: 201,
          headers: { Location: `${url.origin}/tusupload/up-1` },
        });
      }
      patches++;
      return new Response("gone", { status: 410 });
    },
  });
  try {
    await expect(
      tusUpload({
        libraryId: 4321,
        apiKey: "k",
        videoId: "v",
        filePath: file,
        size: contents.length,
        title: "clip.mp4",
        endpoint: `http://localhost:${server.port}/tusupload`,
        chunkSize: 256,
        retryDelayMs: 1,
      }),
    ).rejects.toThrow(/failed at 0 of 1000 bytes \(HTTP 410\)/);
    expect(patches).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("tusUpload accepts a relative Location header", async () => {
  let patched = false;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (request.method === "POST") {
        return new Response(null, {
          status: 201,
          headers: { Location: "/tusupload/up-1" },
        });
      }
      patched = true;
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(contents.length) },
      });
    },
  });
  try {
    await tusUpload({
      libraryId: 4321,
      apiKey: "k",
      videoId: "v",
      filePath: file,
      size: contents.length,
      title: "clip.mp4",
      endpoint: `http://localhost:${server.port}/tusupload`,
      chunkSize: 4096,
    });
    expect(patched).toBe(true);
  } finally {
    server.stop(true);
  }
});
