import { expect, test } from "bun:test";
import type { StorageZoneModel } from "./api.ts";
import { type StorageFile, toStorageFileEntry } from "./files-api.ts";
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

const FILE = {
  objectName: "photo.png",
  path: "/my-assets/images/",
  storageZoneName: "my-assets",
  isDirectory: false,
  length: 1024,
  contentType: "image/png",
  checksum: "ABC",
  lastChanged: new Date("2026-01-01T00:00:00Z"),
} as StorageFile;

test("file paths are zone-relative and ready to reuse as input", () => {
  expect(toStorageFileEntry(FILE)).toEqual({
    name: "photo.png",
    path: "images/photo.png",
    isDirectory: false,
    size: 1024,
    contentType: "image/png",
    checksum: "ABC",
    lastChanged: "2026-01-01T00:00:00.000Z",
  });

  // Root-level files carry no directory prefix.
  const root = toStorageFileEntry({
    ...FILE,
    path: "/my-assets/",
  } as StorageFile);
  expect(root.path).toBe("photo.png");
});

test("directories keep the trailing slash that makes deletes recursive", () => {
  const dir = toStorageFileEntry({
    ...FILE,
    objectName: "images",
    path: "/my-assets/",
    isDirectory: true,
  } as StorageFile);
  expect(dir.path).toBe("images/");
  expect(dir.name).toBe("images");
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
