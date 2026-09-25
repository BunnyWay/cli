import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceAdapter } from "@bunny.net/stream-import";
import { muxSource } from "@bunny.net/stream-import-mux";
import {
  type CoreClient,
  createToolContext,
  type StreamClient,
} from "../../context.ts";
import { inputJsonSchema } from "../../schema.ts";
import {
  importStatePath,
  streamImportPlan,
  streamImportRun,
  streamImportSources,
} from "./index.ts";

const LIBRARY = { Id: 7, Name: "Films", VideoCount: 0, ApiKey: "lib-key" };

const core = {
  GET: async (path: string) =>
    path === "/user" ? { data: { AccountId: "acct" } } : { data: LIBRARY },
} as unknown as CoreClient;

const stream = {
  use: () => {},
  GET: async () => ({ data: { items: [], totalItems: 0 } }),
  POST: async () => ({ data: { id: "guid-1", success: true } }),
} as unknown as StreamClient;

function fakeAdapter(listed: string[]): SourceAdapter {
  return {
    id: "mux",
    dedupTag: "muxAssetId",
    validateCredentials: async () => {},
    listContent: async () => {
      listed.push("list");
      return {
        folders: [],
        videos: new Map(),
        uncategorizedVideos: [
          { sourceId: "a1", displayName: "Intro", folderId: null },
        ],
      };
    },
    getDownloadInfo: async () => ({
      url: "https://example.com/a1.mp4",
      title: "Intro",
    }),
  };
}

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunny-import-tool-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function context(env: Record<string, string>) {
  return createToolContext({
    env: { XDG_STATE_HOME: dir, ...env },
    clients: { core, streamLibrary: () => stream },
  });
}

test("stream.import.run takes no credentials as input and resolves them from ctx.env", async () => {
  const configs: unknown[] = [];
  const spy = spyOn(muxSource, "createAdapter").mockImplementation((config) => {
    configs.push(config);
    return fakeAdapter([]);
  });
  try {
    const properties = Object.keys(
      (inputJsonSchema(streamImportRun) as { properties: object }).properties,
    );
    expect(properties).not.toContain("tokenSecret");
    await expect(
      streamImportRun.invoke(context({}), {
        library: "7",
        source: "mux",
        tokenId: "id",
      }),
    ).rejects.toThrow(/Unrecognized key/);
    await expect(
      streamImportRun.invoke(context({}), { library: "7", source: "mux" }),
    ).rejects.toThrow(/MUX_TOKEN_ID/);

    const result = await streamImportRun.invoke(
      context({ MUX_TOKEN_ID: "id", MUX_TOKEN_SECRET: "secret" }),
      { library: "7", source: "mux" },
    );
    expect(configs).toEqual([{ tokenId: "id", tokenSecret: "secret" }]);
    expect(result).toMatchObject({ queued: 1, processing: 1, failed: [] });
    expect(result.statePath).toBe(
      importStatePath("mux", 7, "acct", { XDG_STATE_HOME: dir }),
    );
  } finally {
    spy.mockRestore();
  }
});

test("stream.import.plan writes nothing, and a later run discovers afresh instead of reusing the plan", async () => {
  const listed: string[] = [];
  const spy = spyOn(muxSource, "createAdapter").mockImplementation(() =>
    fakeAdapter(listed),
  );
  try {
    const ctx = context({ MUX_TOKEN_ID: "id", MUX_TOKEN_SECRET: "secret" });
    const input = { library: "7", source: "mux" };

    const plan = await streamImportPlan.invoke(ctx, { ...input, limit: 0 });
    expect(plan.summary).toMatchObject({ totalVideos: 1, newVideos: 1 });
    expect(plan).toMatchObject({
      truncated: true,
      summary: { newVideosList: [] },
    });
    expect(existsSync(join(dir, "bunnynet"))).toBe(false);

    const run = await streamImportRun.invoke(ctx, {
      ...input,
      expectedCount: 2,
    });
    expect(listed).toEqual(["list", "list"]);
    expect(run.warnings).toEqual([
      "The source changed after the plan: 2 videos were confirmed, 1 were queued.",
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
  }
});

test("a context created without env sees none of the host's variables", async () => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    MUX_TOKEN_ID: "id",
    MUX_TOKEN_SECRET: "secret",
  });
  try {
    const sources = await streamImportSources.invoke(createToolContext(), {});
    expect(sources.find((s) => s.id === "mux")?.readiness).toBe("unconfigured");
  } finally {
    for (const key of ["MUX_TOKEN_ID", "MUX_TOKEN_SECRET"]) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});

test("s3 without static keys is only ready when the host allows ambient credentials", async () => {
  const env = { AWS_REGION: "us-east-1", S3_BUCKET: "videos" };
  const s3 = async (allowAmbientCredentials: boolean) =>
    (
      await streamImportSources.invoke(
        createToolContext({ env, allowAmbientCredentials }),
        {},
      )
    ).find((s) => s.id === "s3");
  expect(await s3(false)).toMatchObject({
    readiness: "partial",
    missing: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  });
  expect(await s3(true)).toMatchObject({ readiness: "ready", missing: [] });
});

test("an abort during the library lookup returns a paused run instead of throwing", async () => {
  const controller = new AbortController();
  const aborting = {
    GET: async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    },
  } as unknown as CoreClient;
  const result = await streamImportRun.invoke(
    createToolContext({
      env: { XDG_STATE_HOME: dir, MUX_TOKEN_ID: "id", MUX_TOKEN_SECRET: "s" },
      clients: { core: aborting, streamLibrary: () => stream },
      signal: controller.signal,
    }),
    { library: "7", source: "mux" },
  );
  expect(result).toMatchObject({
    status: "paused",
    library: null,
    queued: 0,
    statePath: null,
  });
});
