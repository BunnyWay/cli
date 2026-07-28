import { describe, expect, test } from "bun:test";
import { isEncrypted, sameHost } from "./credentials.ts";

const CANONICAL = "libsql://my-db-abc.lite.bunnydb.net/";

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

describe("sameHost", () => {
  test("accepts the canonical URL with or without a trailing slash", () => {
    expect(sameHost("libsql://my-db-abc.lite.bunnydb.net", CANONICAL)).toBe(
      true,
    );
    expect(sameHost(CANONICAL, CANONICAL)).toBe(true);
  });

  test("accepts https for the same host, since libsql maps onto it", () => {
    expect(sameHost("https://my-db-abc.lite.bunnydb.net", CANONICAL)).toBe(
      true,
    );
  });

  test("ignores host casing and path", () => {
    expect(
      sameHost("libsql://MY-DB-ABC.lite.bunnydb.net/anything", CANONICAL),
    ).toBe(true);
  });

  test("rejects a different database on the same domain", () => {
    expect(sameHost("libsql://other-db-xyz.lite.bunnydb.net", CANONICAL)).toBe(
      false,
    );
  });

  test("rejects a foreign host", () => {
    expect(sameHost("libsql://evil.example.com", CANONICAL)).toBe(false);
  });

  test("rejects a host that only prefixes the canonical one", () => {
    expect(
      sameHost("libsql://my-db-abc.lite.bunnydb.net.example.com", CANONICAL),
    ).toBe(false);
  });

  test("rejects unparseable input rather than treating it as a match", () => {
    expect(sameHost("my-db-abc.lite.bunnydb.net", CANONICAL)).toBe(false);
    expect(sameHost("", CANONICAL)).toBe(false);
  });
});
