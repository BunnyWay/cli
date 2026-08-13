import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  databaseTarget,
  envTokenAllowedFor,
  isEncrypted,
  resolveCredentials,
  sameEndpoint,
} from "./credentials.ts";

const CANONICAL = "libsql://my-db-abc.lite.bunnydb.net/";

describe("databaseTarget", () => {
  test("shows the database ID and host without URL credentials or paths", () => {
    expect(
      databaseTarget(
        "libsql://user:secret@my-db-abc.lite.bunnydb.net/private?token=nope",
        "db_123",
      ),
    ).toEqual({
      databaseId: "db_123",
      host: "my-db-abc.lite.bunnydb.net",
      label: "db_123 (my-db-abc.lite.bunnydb.net)",
    });
  });

  test("falls back to the host when no database ID is known", () => {
    expect(databaseTarget(CANONICAL)).toEqual({
      databaseId: null,
      host: "my-db-abc.lite.bunnydb.net",
      label: "my-db-abc.lite.bunnydb.net",
    });
  });
});

describe("envTokenAllowedFor", () => {
  test("allows the .env token when no --url overrides it", () => {
    expect(envTokenAllowedFor(undefined, CANONICAL)).toBe(true);
    expect(envTokenAllowedFor(undefined, undefined)).toBe(false);
  });

  test("allows a --url naming the same endpoint as the .env URL", () => {
    expect(
      envTokenAllowedFor("libsql://my-db-abc.lite.bunnydb.net", CANONICAL),
    ).toBe(true);
    expect(
      envTokenAllowedFor("https://my-db-abc.lite.bunnydb.net", CANONICAL),
    ).toBe(true);
  });

  test("refuses an encrypted --url on a different host", () => {
    expect(envTokenAllowedFor("https://evil.example.com", CANONICAL)).toBe(
      false,
    );
    expect(
      envTokenAllowedFor("libsql://other-db.lite.bunnydb.net", CANONICAL),
    ).toBe(false);
  });

  test("refuses an encrypted --url on a different port", () => {
    expect(
      envTokenAllowedFor("libsql://my-db-abc.lite.bunnydb.net:8443", CANONICAL),
    ).toBe(false);
  });

  test("refuses a plaintext --url even on the matching host", () => {
    expect(
      envTokenAllowedFor("http://my-db-abc.lite.bunnydb.net", CANONICAL),
    ).toBe(false);
    expect(
      envTokenAllowedFor(
        "libsql://my-db-abc.lite.bunnydb.net:8080?tls=0",
        CANONICAL,
      ),
    ).toBe(false);
  });

  test("refuses when .env has a token but no URL to pair it with", () => {
    expect(
      envTokenAllowedFor("https://my-db-abc.lite.bunnydb.net", undefined),
    ).toBe(false);
  });
});

describe("isEncrypted", () => {
  test("accepts libsql, https, and wss", () => {
    expect(isEncrypted("libsql://h.lite.bunnydb.net")).toBe(true);
    expect(isEncrypted("https://h.lite.bunnydb.net")).toBe(true);
    expect(isEncrypted("wss://h.lite.bunnydb.net")).toBe(true);
  });

  test("rejects plaintext schemes", () => {
    expect(isEncrypted("http://h.lite.bunnydb.net")).toBe(false);
    expect(isEncrypted("ws://h.lite.bunnydb.net")).toBe(false);
  });

  test("rejects libsql that opts out of TLS, which downgrades to http", () => {
    expect(isEncrypted("libsql://h.lite.bunnydb.net:8080?tls=0")).toBe(false);
  });

  test("still accepts libsql with tls left on", () => {
    expect(isEncrypted("libsql://h.lite.bunnydb.net:8080?tls=1")).toBe(true);
  });

  test("rejects unparseable input", () => {
    expect(isEncrypted("h.lite.bunnydb.net")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });
});

describe("sameEndpoint", () => {
  test("accepts the canonical URL with or without a trailing slash", () => {
    expect(sameEndpoint("libsql://my-db-abc.lite.bunnydb.net", CANONICAL)).toBe(
      true,
    );
    expect(sameEndpoint(CANONICAL, CANONICAL)).toBe(true);
  });

  test("accepts https for the same endpoint, since libsql maps onto it", () => {
    expect(sameEndpoint("https://my-db-abc.lite.bunnydb.net", CANONICAL)).toBe(
      true,
    );
  });

  test("normalizes an explicit default TLS port", () => {
    expect(
      sameEndpoint("libsql://my-db-abc.lite.bunnydb.net:443", CANONICAL),
    ).toBe(true);
  });

  test("rejects an alternate service port", () => {
    expect(
      sameEndpoint("libsql://my-db-abc.lite.bunnydb.net:8443", CANONICAL),
    ).toBe(false);
  });

  test("ignores host casing and path", () => {
    expect(
      sameEndpoint("libsql://MY-DB-ABC.lite.bunnydb.net/anything", CANONICAL),
    ).toBe(true);
  });

  test("rejects a different database on the same domain", () => {
    expect(
      sameEndpoint("libsql://other-db-xyz.lite.bunnydb.net", CANONICAL),
    ).toBe(false);
  });

  test("rejects a foreign host", () => {
    expect(sameEndpoint("libsql://evil.example.com", CANONICAL)).toBe(false);
  });

  test("rejects a host that only prefixes the canonical one", () => {
    expect(
      sameEndpoint(
        "libsql://my-db-abc.lite.bunnydb.net.example.com",
        CANONICAL,
      ),
    ).toBe(false);
  });

  test("rejects unparseable input rather than treating it as a match", () => {
    expect(sameEndpoint("my-db-abc.lite.bunnydb.net", CANONICAL)).toBe(false);
    expect(sameEndpoint("", CANONICAL)).toBe(false);
  });
});

describe("resolveCredentials", () => {
  test("rejects a plaintext explicit URL even with an explicit token", async () => {
    await expect(
      resolveCredentials({
        profile: "default",
        url: "http://my-db-abc.lite.bunnydb.net",
        token: "explicit-token",
      }),
    ).rejects.toThrow("Database URL must use an encrypted connection.");
  });

  test("returns an encrypted explicit URL and token without an API lookup", async () => {
    await expect(
      resolveCredentials({
        profile: "default",
        url: CANONICAL,
        token: "explicit-token",
      }),
    ).resolves.toEqual({
      url: CANONICAL,
      token: "explicit-token",
      databaseId: undefined,
      tokenGenerated: false,
    });
  });

  test("rejects a plaintext .env URL before returning its ambient token", async () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), "bunny-db-credentials-"));
    writeFileSync(
      join(dir, ".env"),
      [
        "BUNNY_DATABASE_URL=http://my-db-abc.lite.bunnydb.net",
        "BUNNY_DATABASE_AUTH_TOKEN=ambient-token",
      ].join("\n"),
    );
    process.chdir(dir);

    try {
      await expect(resolveCredentials({ profile: "default" })).rejects.toThrow(
        "Database URL must use an encrypted connection.",
      );
    } finally {
      process.chdir(cwd);
    }
  });
});
