import { expect, test } from "bun:test";
import type { StorageZoneModel } from "./api.ts";
import {
  connectionChoices,
  connectionJson,
  connectionRows,
  hasSecret,
  storageConnection,
} from "./connection.ts";

const ZONE: StorageZoneModel = {
  Name: "my-zone",
  Password: "rw-pass",
  Region: "NY",
  StorageHostname: "ny.storage.bunnycdn.com",
  StorageZoneType: 1,
};

test("ftp connection exposes the zone host, name, and password", () => {
  const conn = storageConnection(ZONE, "ftp");
  expect(connectionJson(conn)).toEqual({
    type: "ftp",
    host: "ny.storage.bunnycdn.com",
    username: "my-zone",
    password: "rw-pass",
  });
  expect(conn.env).toEqual([
    { key: "BUNNY_STORAGE_ZONE", value: "my-zone" },
    { key: "BUNNY_STORAGE_PASSWORD", value: "rw-pass" },
    { key: "BUNNY_STORAGE_REGION", value: "NY" },
  ]);
  // Requested credentials render in full, and are still flagged as sensitive.
  expect(connectionRows(conn).at(-1)?.value).toBe("rw-pass");
  expect(hasSecret(conn)).toBe(true);
});

test("s3 connection reuses the derived endpoint and keys", () => {
  expect(connectionJson(storageConnection(ZONE, "s3"))).toEqual({
    type: "s3",
    endpoint: "https://ny-s3.storage.bunnycdn.com",
    region: "ny",
    accessKeyId: "my-zone",
    secretAccessKey: "rw-pass",
  });
});

test("s3 is only offered when enabled, and ftp needs a password", () => {
  expect(connectionChoices(ZONE).map((c) => c.value)).toEqual(["ftp", "s3"]);
  expect(
    connectionChoices({ ...ZONE, StorageZoneType: 0 }).map((c) => c.value),
  ).toEqual(["ftp"]);
  expect(() => storageConnection({ ...ZONE, Password: null }, "ftp")).toThrow(
    /No password available/,
  );
});
