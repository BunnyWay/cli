import { afterEach, expect, test } from "bun:test";
import * as BunnyStorage from "@bunny.net/storage-sdk";
import type { StorageZoneModel } from "./api.ts";
import {
  connectStorageZone,
  deleteFile,
  isZoneRoot,
  listFiles,
} from "./files-api.ts";

const ZONE: StorageZoneModel = {
  Name: "my-zone",
  Password: "zone-password",
  Region: "NY",
  StorageHostname: "ny.storage.bunnycdn.com",
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("connectStorageZone maps the region code and zone password", () => {
  const connection = connectStorageZone(ZONE);
  expect(connection.name).toBe("my-zone");
  expect(connection.accessKey).toBe("zone-password");
  expect(BunnyStorage.zone.addr(connection).toString()).toBe(
    "https://ny.storage.bunnycdn.com/my-zone/",
  );
});

test("connectStorageZone requires a zone password", () => {
  expect(() => connectStorageZone({ ...ZONE, Password: null })).toThrow(
    /No password/,
  );
});

test("connectStorageZone rejects an unknown region", () => {
  expect(() => connectStorageZone({ ...ZONE, Region: "MARS" })).toThrow(
    /Unsupported storage region/,
  );
});

test("deleteFile reports a missing path", async () => {
  globalThis.fetch = (async () =>
    new Response(null, { status: 404 })) as unknown as typeof fetch;
  const connection = connectStorageZone(ZONE);
  await expect(deleteFile(connection, "missing.png")).rejects.toThrow(
    /Path not found in my-zone: "missing.png"/,
  );
});

test("deleteFile surfaces the status for an unexpected failure", async () => {
  globalThis.fetch = (async () =>
    new Response(null, { status: 500 })) as unknown as typeof fetch;
  const connection = connectStorageZone(ZONE);
  await expect(deleteFile(connection, "photo.png")).rejects.toThrow(/HTTP 500/);
});

test("deleteFile uses the recursive endpoint for directories", async () => {
  const requested = respondWith(null);
  await deleteFile(connectStorageZone(ZONE), "images/");
  expect(lastInit?.method).toBe("DELETE");
  expect(requested().toString()).toBe(
    "https://ny.storage.bunnycdn.com/my-zone/images/",
  );
});

test("deleteFile does not double the slash on an absolute path", async () => {
  const requested = respondWith(null);
  await deleteFile(connectStorageZone(ZONE), "/images/photo.png");
  expect(requested().toString()).toBe(
    "https://ny.storage.bunnycdn.com/my-zone/images/photo.png",
  );
});

test("deleteFile bypasses the root guard when emptying the zone", async () => {
  const requested = respondWith(null);
  await deleteFile(connectStorageZone(ZONE), "/");
  expect(requested().toString()).toBe(
    "https://ny.storage.bunnycdn.com/my-zone/?allowRootDelete=true",
  );
});

test("deleteFile keeps the root guard off for a normal path", async () => {
  const requested = respondWith(null);
  await deleteFile(connectStorageZone(ZONE), "images/");
  expect(requested().searchParams.has("allowRootDelete")).toBe(false);
});

test("isZoneRoot recognises the root and nothing else", () => {
  expect(isZoneRoot("/")).toBe(true);
  expect(isZoneRoot("")).toBe(true);
  expect(isZoneRoot("//")).toBe(true);
  expect(isZoneRoot("images/")).toBe(false);
  expect(isZoneRoot("/images")).toBe(false);
});

const ENTRY = {
  Guid: "9accb95a-e28d-4fc0-88a5-c93bc0795622",
  UserId: "9accb95a-e28d-4fc0-88a5-c93bc0795622",
  LastChanged: "2026-08-18T17:05:12",
  DateCreated: "2026-08-18T17:05:12",
  StorageZoneName: "my-zone",
  StorageZoneId: 1760392,
  Path: "/my-zone/",
  ObjectName: "photo.png",
  Length: 2048,
  IsDirectory: false,
  ServerId: 42,
  Checksum: null,
  ReplicatedZones: "DE,UK",
  ContentType: "image/png",
};

let lastInit: RequestInit | undefined;

function respondWith(body: unknown, status = 200): () => URL {
  let requested = new URL("https://unset.invalid");
  lastInit = undefined;
  globalThis.fetch = (async (input: URL, init?: RequestInit) => {
    requested = input;
    lastInit = init;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return () => requested;
}

test("listFiles accepts replication regions the SDK schema omits", async () => {
  respondWith([ENTRY]);
  const files = await listFiles(connectStorageZone(ZONE), "");
  expect(files).toHaveLength(1);
  expect(files[0]?.replicatedZones).toEqual(["DE", "UK"]);
  expect(files[0]?.objectName).toBe("photo.png");
  expect(files[0]?.lastChanged).toBeInstanceOf(Date);
});

test("listFiles returns null replicated zones when the field is empty", async () => {
  respondWith([{ ...ENTRY, ReplicatedZones: null }]);
  const [file] = await listFiles(connectStorageZone(ZONE), "");
  expect(file?.replicatedZones).toBeNull();
});

test("listFiles requests the zone root without a doubled slash", async () => {
  const requested = respondWith([]);
  await listFiles(connectStorageZone(ZONE), "");
  expect(requested().toString()).toBe(
    "https://ny.storage.bunnycdn.com/my-zone/",
  );
});

test("listFiles normalises a nested directory path", async () => {
  const requested = respondWith([]);
  await listFiles(connectStorageZone(ZONE), "/images");
  expect(requested().toString()).toBe(
    "https://ny.storage.bunnycdn.com/my-zone/images/",
  );
});

test("listFiles reports an unauthorized zone", async () => {
  respondWith([], 401);
  await expect(listFiles(connectStorageZone(ZONE), "")).rejects.toThrow(
    /Unauthorized access to storage zone my-zone/,
  );
});
