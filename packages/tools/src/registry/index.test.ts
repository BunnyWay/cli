import { expect, test } from "bun:test";
import { type CoreClient, createToolContext } from "../context.ts";
import type { RegistryClient } from "./client.ts";
import { registryRepositories, registryTags } from "./index.ts";

const ACCOUNT = "acct123";

/** A core client that answers /user, plus a registry client backed by canned OCI responses. */
function fakeClients(responses: Record<string, unknown>, paths: string[] = []) {
  const core = {
    GET: () => Promise.resolve({ data: { AccountId: "ACCT123" } }),
  } as unknown as CoreClient;
  const registry = {
    endpoint: {
      baseUrl: "https://registry.bunny.net",
      host: "registry.bunny.net",
    },
    get: (path: string) => {
      paths.push(path);
      return Promise.resolve(responses[path]);
    },
  } as unknown as RegistryClient;
  return { ctx: createToolContext({ clients: { core, registry } }), paths };
}

test("registry.repositories drops the account prefix and sorts", async () => {
  const { ctx } = fakeClients({
    "/v2/_catalog": {
      repositories: [`${ACCOUNT}/web`, `${ACCOUNT}/api`, "other/thing"],
    },
  });

  expect(await registryRepositories.invoke(ctx, {})).toEqual([
    "api",
    "other/thing",
    "web",
  ]);
});

test("registry.tags qualifies a bare repository and reports the bare name back", async () => {
  const { ctx, paths } = fakeClients({
    [`/v2/${ACCOUNT}/myapp/tags/list`]: { tags: ["latest", "v1"] },
  });

  expect(await registryTags.invoke(ctx, { repository: "myapp" })).toEqual({
    repository: "myapp",
    tags: ["latest", "v1"],
  });
  expect(paths).toEqual([`/v2/${ACCOUNT}/myapp/tags/list`]);
});

test("registry.tags accepts an already-qualified repository", async () => {
  const { ctx, paths } = fakeClients({
    [`/v2/${ACCOUNT}/myapp/tags/list`]: {},
  });

  expect(
    (await registryTags.invoke(ctx, { repository: `${ACCOUNT}/myapp` })).tags,
  ).toEqual([]);
  expect(paths).toEqual([`/v2/${ACCOUNT}/myapp/tags/list`]);
});

test("registry.tags rejects an empty repository before any request", async () => {
  const { ctx, paths } = fakeClients({});

  expect(registryTags.invoke(ctx, { repository: "" })).rejects.toThrow(
    /Invalid input/,
  );
  expect(paths).toEqual([]);
});
