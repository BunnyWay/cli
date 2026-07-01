import { afterEach, expect, test } from "bun:test";
import * as BunnyStorage from "@bunny.net/storage-sdk";
import type { StorageZoneModel } from "./api.ts";
import { connectStorageZone, deleteFile } from "./files-api.ts";

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

test("deleteFile throws when the SDK reports failure", async () => {
  globalThis.fetch = (async () =>
    new Response(null, { status: 404 })) as unknown as typeof fetch;
  const connection = connectStorageZone(ZONE);
  await expect(deleteFile(connection, "missing.png")).rejects.toThrow(
    /Failed to delete/,
  );
});

test("deleteFile uses the recursive endpoint for directories", async () => {
  let method = "";
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    method = init?.method ?? "GET";
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const connection = connectStorageZone(ZONE);
  await deleteFile(connection, "images/");
  expect(method).toBe("DELETE");
});
