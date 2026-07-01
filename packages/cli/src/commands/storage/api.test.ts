import { describe, expect, test } from "bun:test";
import { type StorageZoneModel, toSafeStorageZone } from "./api.ts";

describe("toSafeStorageZone", () => {
  const zone = {
    Id: 1,
    Name: "my-zone",
    Region: "DE",
    Password: "rw-secret",
    ReadOnlyPassword: "ro-secret",
    StorageUsed: 1024,
  } as StorageZoneModel;

  test("drops both passwords", () => {
    const safe = toSafeStorageZone(zone);
    expect("Password" in safe).toBe(false);
    expect("ReadOnlyPassword" in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain("secret");
  });

  test("preserves every non-secret field", () => {
    expect(toSafeStorageZone(zone)).toEqual({
      Id: 1,
      Name: "my-zone",
      Region: "DE",
      StorageUsed: 1024,
    } as StorageZoneModel);
  });

  test("does not mutate the original zone", () => {
    toSafeStorageZone(zone);
    expect(zone.Password).toBe("rw-secret");
  });
});
