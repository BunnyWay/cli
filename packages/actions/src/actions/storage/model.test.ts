import { expect, test } from "bun:test";
import type { StorageZoneModel } from "./api.ts";
import { toStorageZone } from "./model.ts";

const ZONE: StorageZoneModel = {
  Id: 123,
  Name: "my-assets",
  Region: "DE",
  ReplicationRegions: ["NY"],
  StorageHostname: "storage.bunnycdn.com",
  FilesStored: 7,
  StorageUsed: 2048,
  DateModified: "2026-01-01T00:00:00Z",
  StorageZoneType: 1,
  Password: "rw-secret",
  ReadOnlyPassword: "ro-secret",
} as StorageZoneModel;

test("normalizes a zone and derives the S3 endpoint", () => {
  expect(toStorageZone(ZONE)).toEqual({
    id: 123,
    name: "my-assets",
    region: "DE",
    replicationRegions: ["NY"],
    hostname: "storage.bunnycdn.com",
    filesStored: 7,
    storageUsed: 2048,
    dateModified: "2026-01-01T00:00:00Z",
    s3: { enabled: true, endpoint: "https://de-s3.storage.bunnycdn.com" },
  });
});

test("never carries zone passwords into the result", () => {
  const serialized = JSON.stringify(toStorageZone(ZONE));
  expect(serialized).not.toContain("rw-secret");
  expect(serialized).not.toContain("ro-secret");
});

test("fills in defaults for a sparse zone", () => {
  const zone = toStorageZone({ Id: 1, Name: "bare" } as StorageZoneModel);
  expect(zone).toMatchObject({
    region: "",
    replicationRegions: [],
    hostname: null,
    filesStored: 0,
    storageUsed: 0,
    dateModified: null,
    s3: { enabled: false, endpoint: null },
  });
});
