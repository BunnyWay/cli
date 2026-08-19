import { expect, test } from "bun:test";
import type { StorageZoneModel } from "./api.ts";
import {
  clientType,
  connectionChoices,
  connectionJson,
  connectionRows,
  hasSecret,
  storageConnection,
} from "./connection.ts";

const ZONE: StorageZoneModel = {
  Name: "my-zone",
  Password: "rw-pass",
  ReadOnlyPassword: "ro-pass",
  Region: "NY",
  StorageHostname: "ny.storage.bunnycdn.com",
  StorageZoneType: 1,
};

test("each connection type shapes the same password differently", () => {
  expect(connectionJson(storageConnection(ZONE, "http"))).toEqual({
    type: "http",
    baseUrl: "https://ny.storage.bunnycdn.com/my-zone/",
    accessKey: "rw-pass",
  });
  expect(connectionJson(storageConnection(ZONE, "ftp"))).toEqual({
    type: "ftp",
    host: "ny.storage.bunnycdn.com",
    username: "my-zone",
    password: "rw-pass",
  });
  expect(connectionJson(storageConnection(ZONE, "s3"))).toEqual({
    type: "s3",
    endpoint: "https://ny-s3.storage.bunnycdn.com",
    region: "ny",
    accessKeyId: "my-zone",
    secretAccessKey: "rw-pass",
  });
});

test("read-only swaps the secret on every type", () => {
  const opts = { readOnly: true };
  expect(connectionJson(storageConnection(ZONE, "http", opts)).accessKey).toBe(
    "ro-pass",
  );
  expect(connectionJson(storageConnection(ZONE, "ftp", opts)).password).toBe(
    "ro-pass",
  );
  expect(
    connectionJson(storageConnection(ZONE, "s3", opts)).secretAccessKey,
  ).toBe("ro-pass");
});

test("secrets render in full or masked, and .env carries the real value", () => {
  const conn = storageConnection(ZONE, "ftp");
  expect(connectionRows(conn).at(-1)?.value).toBe("rw-pass");
  expect(connectionRows(conn, { mask: true }).at(-1)?.value).not.toBe(
    "rw-pass",
  );
  expect(hasSecret(conn)).toBe(true);
  expect(conn.env).toEqual([
    { key: "BUNNY_STORAGE_ZONE", value: "my-zone" },
    { key: "BUNNY_STORAGE_PASSWORD", value: "rw-pass" },
    { key: "BUNNY_STORAGE_REGION", value: "NY" },
  ]);
});

test("s3 is only offered when enabled, and a missing password errors", () => {
  expect(connectionChoices(ZONE).map((c) => c.value)).toEqual([
    "http",
    "ftp",
    "s3",
  ]);
  expect(
    connectionChoices({ ...ZONE, StorageZoneType: 0 }).map((c) => c.value),
  ).toEqual(["http", "ftp"]);
  expect(() => storageConnection({ ...ZONE, Password: null }, "ftp")).toThrow(
    /No password available/,
  );
});

test("every type links to its own docs page", () => {
  expect(storageConnection(ZONE, "http").docs).toEndWith("/storage/http");
  expect(storageConnection(ZONE, "ftp").docs).toEndWith("/storage/ftp");
  expect(storageConnection(ZONE, "s3").docs).toEndWith("/storage/s3");
});

test("clients belong to the protocol that can use them", () => {
  expect(clientType("sdk")).toBe("http");
  expect(clientType("rclone")).toBe("s3");
});
