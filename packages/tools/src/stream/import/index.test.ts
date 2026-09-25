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
import { importStatePath, streamImportPlan, streamImportRun } from "./index.ts";

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

test("stream.import.plan writes nothing, and a run on the same context reuses its discovery", async () => {
  const listed: string[] = [];
  const spy = spyOn(muxSource, "createAdapter").mockImplementation(() =>
    fakeAdapter(listed),
  );
  try {
    const ctx = context({ MUX_TOKEN_ID: "id", MUX_TOKEN_SECRET: "secret" });
    const input = { library: "7", source: "mux" };

    const plan = await streamImportPlan.invoke(ctx, input);
    expect(plan.summary).toMatchObject({ totalVideos: 1, newVideos: 1 });
    expect(existsSync(join(dir, "bunnynet"))).toBe(false);

    await streamImportRun.invoke(ctx, input);
    expect(listed).toEqual(["list"]);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});
