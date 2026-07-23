import { expect, test } from "bun:test";
import { type CoreClient, createActionContext } from "../../context.ts";
import {
  storageZonesCredentials,
  storageZonesDelete,
  storageZonesList,
  storageZonesUpdate,
} from "./index.ts";

type Call = [string, unknown];

function fakeCore(
  responses: Record<string, unknown>,
  calls: Call[] = [],
): { core: CoreClient; calls: Call[] } {
  const handler = (path: string, opts: unknown) => {
    calls.push([path, opts]);
    return Promise.resolve({ data: responses[path] });
  };
  return {
    core: {
      GET: handler,
      POST: handler,
      DELETE: handler,
    } as unknown as CoreClient,
    calls,
  };
}

test("storage.zones.list normalizes and reports progress", async () => {
  const { core, calls } = fakeCore({
    "/storagezone": [
      { Id: 2, Name: "b-zone", Region: "NY", FilesStored: 1, StorageUsed: 10 },
      { Id: 1, Name: "a-zone", Region: "DE", FilesStored: 0, StorageUsed: 0 },
    ],
  });
  const progress: string[] = [];
  const ctx = createActionContext({
    clients: { core },
    onProgress: (message) => progress.push(message),
  });

  const zones = await storageZonesList.invoke(ctx, { search: "zone" });

  expect(zones.map((zone) => zone.name)).toEqual(["a-zone", "b-zone"]);
  expect(zones[0]).toMatchObject({ id: 1, region: "DE", filesStored: 0 });
  expect(calls[0]?.[1]).toMatchObject({
    params: { query: { search: "zone" } },
  });
  expect(progress).toEqual(["Fetching storage zones..."]);
});

test("storage.zones.list filters by search term client-side", async () => {
  const { core } = fakeCore({
    "/storagezone": [
      { Id: 1, Name: "assets-eu" },
      { Id: 2, Name: "logs" },
    ],
  });
  const ctx = createActionContext({ clients: { core } });

  const zones = await storageZonesList.invoke(ctx, { search: "ASSETS" });

  expect(zones.map((zone) => zone.name)).toEqual(["assets-eu"]);
});

test("storage.zones.delete resolves the zone, then deletes it", async () => {
  const { core, calls } = fakeCore({
    "/storagezone/{id}": { Id: 123, Name: "my-assets", Region: "DE" },
  });
  const ctx = createActionContext({ clients: { core } });

  const result = await storageZonesDelete.invoke(ctx, { zone: "123" });

  expect(result).toEqual({ id: 123, name: "my-assets", deleted: true });
  expect(calls.map(([path]) => path)).toEqual([
    "/storagezone/{id}",
    "/storagezone/{id}",
  ]);
  expect(calls[1]?.[1]).toMatchObject({ params: { path: { id: 123 } } });
});

test("storage.zones.update merges replication instead of replacing it", async () => {
  const { core, calls } = fakeCore({
    "/storagezone/{id}": {
      Id: 5,
      Name: "my-assets",
      Region: "DE",
      ReplicationRegions: ["NY"],
    },
  });
  const ctx = createActionContext({ clients: { core } });

  const result = await storageZonesUpdate.invoke(ctx, {
    zone: "5",
    custom404FilePath: "/404.html",
    replicationRegions: ["LA"],
  });

  // resolve -> POST settings -> read back
  const post = calls[1]?.[1] as { body: Record<string, unknown> };
  expect(post.body).toEqual({
    Custom404FilePath: "/404.html",
    ReplicationZones: ["NY", "LA"],
  });
  expect(result.replicationAdded).toEqual(["LA"]);
  expect(result.replicationKept).toEqual(["NY"]);
});

test("storage.zones.update leaves replication alone when not asked", async () => {
  const { core, calls } = fakeCore({
    "/storagezone/{id}": {
      Id: 5,
      Name: "my-assets",
      ReplicationRegions: ["NY"],
    },
  });
  const ctx = createActionContext({ clients: { core } });

  await storageZonesUpdate.invoke(ctx, { zone: "5", rewrite404To200: true });

  const post = calls[1]?.[1] as { body: Record<string, unknown> };
  expect(post.body).toEqual({ Rewrite404To200: true });
});

test("storage.zones.credentials is marked sensitive and returns the secret", async () => {
  const { core } = fakeCore({
    "/storagezone/{id}": {
      Id: 5,
      Name: "my-assets",
      Region: "DE",
      Password: "rw-secret",
      ReadOnlyPassword: "ro-secret",
      StorageZoneType: 1,
    },
  });
  const ctx = createActionContext({ clients: { core } });

  expect(storageZonesCredentials.sensitive).toBe(true);
  expect(await storageZonesCredentials.invoke(ctx, { zone: "5" })).toEqual({
    endpoint: "https://de-s3.storage.bunnycdn.com",
    region: "de",
    accessKeyId: "my-assets",
    secretAccessKey: "rw-secret",
    zone: "my-assets",
    s3Enabled: true,
    readOnly: false,
  });

  const readOnly = await storageZonesCredentials.invoke(ctx, {
    zone: "5",
    readOnly: true,
  });
  expect(readOnly.secretAccessKey).toBe("ro-secret");
});

test("storage.zones.delete rejects an empty zone reference", async () => {
  const { core } = fakeCore({});
  const ctx = createActionContext({ clients: { core } });

  await expect(storageZonesDelete.invoke(ctx, { zone: "" })).rejects.toThrow(
    /Invalid input for "storage.zones.delete"/,
  );
});
