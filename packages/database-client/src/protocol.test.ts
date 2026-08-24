import { describe, expect, test } from "bun:test";
import { DatabaseError } from "./errors.ts";
import { decodeValue, encodeValue, normalizeUrl } from "./protocol.ts";

describe("normalizeUrl", () => {
  test("maps libsql: to https:", () => {
    expect(normalizeUrl("libsql://db.lite.bunnydb.net")).toBe(
      "https://db.lite.bunnydb.net",
    );
  });

  test("strips the trailing slash the API returns", () => {
    expect(normalizeUrl("libsql://db.lite.bunnydb.net/")).toBe(
      "https://db.lite.bunnydb.net",
    );
  });

  test("maps websocket schemes onto their HTTP equivalents", () => {
    expect(normalizeUrl("wss://db.lite.bunnydb.net")).toBe(
      "https://db.lite.bunnydb.net",
    );
    expect(normalizeUrl("ws://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  test("passes https: and http: through", () => {
    expect(normalizeUrl("https://db.lite.bunnydb.net")).toBe(
      "https://db.lite.bunnydb.net",
    );
    expect(normalizeUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  test("keeps a non-default port", () => {
    expect(normalizeUrl("libsql://db.lite.bunnydb.net:8443")).toBe(
      "https://db.lite.bunnydb.net:8443",
    );
  });

  test("honours the libsql tls=0 downgrade", () => {
    expect(normalizeUrl("libsql://127.0.0.1:8080?tls=0")).toBe(
      "http://127.0.0.1:8080",
    );
  });

  test("drops query and fragment", () => {
    expect(normalizeUrl("libsql://db.lite.bunnydb.net?region=eu#frag")).toBe(
      "https://db.lite.bunnydb.net",
    );
  });

  test("rejects credentials embedded in the URL", () => {
    expect(() =>
      normalizeUrl("libsql://user:pass@db.lite.bunnydb.net"),
    ).toThrow(/must not contain credentials/);
    // Dropping this silently would leave the caller with an unexplained 401.
    expect(() =>
      normalizeUrl("libsql://db.lite.bunnydb.net?authToken=leaked"),
    ).toThrow(/must not carry an authToken/);
  });

  test("rejects unknown schemes and non-URLs", () => {
    expect(() => normalizeUrl("file:///tmp/local.db")).toThrow(
      /unsupported URL scheme/,
    );
    expect(() => normalizeUrl("db.lite.bunnydb.net")).toThrow(
      /invalid database URL/,
    );
  });
});

describe("encodeValue", () => {
  test("encodes SQLite's storage classes", () => {
    expect(encodeValue(null)).toEqual({ type: "null" });
    expect(encodeValue("hi")).toEqual({ type: "text", value: "hi" });
    expect(encodeValue(7)).toEqual({ type: "integer", value: "7" });
    expect(encodeValue(1.5)).toEqual({ type: "float", value: 1.5 });
    expect(encodeValue(10n)).toEqual({ type: "integer", value: "10" });
  });

  test("encodes booleans as SQLite's 0 and 1", () => {
    expect(encodeValue(true)).toEqual({ type: "integer", value: "1" });
    expect(encodeValue(false)).toEqual({ type: "integer", value: "0" });
  });

  test("encodes byte arrays as base64 blobs", () => {
    expect(encodeValue(new Uint8Array([1, 2, 255]))).toEqual({
      type: "blob",
      base64: "AQL/",
    });
  });

  test("rejects values SQLite cannot store", () => {
    expect(() => encodeValue(Number.NaN)).toThrow(/non-finite/);
    expect(() => encodeValue(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => encodeValue({ a: 1 })).toThrow(
      /cannot bind value of type object/,
    );
    // A mistyped property should surface, not land in the column as NULL.
    expect(() => encodeValue(undefined)).toThrow(/cannot bind undefined/);
  });

  test("rejects integer numbers past 2^53 instead of silently rounding them", () => {
    expect(() => encodeValue(Number.MAX_SAFE_INTEGER + 2)).toThrow(
      /pass a bigint/,
    );
    expect(() => encodeValue(Number.MIN_SAFE_INTEGER - 2)).toThrow(
      /pass a bigint/,
    );
    expect(encodeValue(Number.MAX_SAFE_INTEGER)).toEqual({
      type: "integer",
      value: "9007199254740991",
    });
  });

  test("accepts the int64 bounds as bigint but rejects beyond them", () => {
    expect(encodeValue(2n ** 63n - 1n)).toEqual({
      type: "integer",
      value: "9223372036854775807",
    });
    expect(encodeValue(-(2n ** 63n))).toEqual({
      type: "integer",
      value: "-9223372036854775808",
    });
    expect(() => encodeValue(2n ** 63n)).toThrow(/64-bit integer range/);
    expect(() => encodeValue(-(2n ** 63n) - 1n)).toThrow(
      /64-bit integer range/,
    );
  });

  test("points Date binds at an explicit conversion instead of guessing one", () => {
    expect(() => encodeValue(new Date(0))).toThrow(
      /toISOString\(\) or date.getTime\(\)/,
    );
  });
});

describe("decodeValue", () => {
  test("decodes the storage classes", () => {
    expect(decodeValue({ type: "null" })).toBeNull();
    expect(decodeValue({ type: "text", value: "hi" })).toBe("hi");
    expect(decodeValue({ type: "float", value: 1.5 })).toBe(1.5);
  });

  test("keeps integers as numbers while they are exactly representable", () => {
    expect(decodeValue({ type: "integer", value: "7" })).toBe(7);
    expect(decodeValue({ type: "integer", value: "-7" })).toBe(-7);
    expect(
      decodeValue({ type: "integer", value: String(Number.MAX_SAFE_INTEGER) }),
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("widens to bigint only where a number would lose precision", () => {
    expect(decodeValue({ type: "integer", value: "9007199254740993" })).toBe(
      9007199254740993n,
    );
    expect(decodeValue({ type: "integer", value: "-9007199254740993" })).toBe(
      -9007199254740993n,
    );
  });

  test("round-trips blobs, including unpadded base64", () => {
    expect(decodeValue({ type: "blob", base64: "AQL/" })).toEqual(
      new Uint8Array([1, 2, 255]),
    );
    expect(decodeValue({ type: "blob", base64: "AQI" })).toEqual(
      new Uint8Array([1, 2]),
    );
  });

  test("round-trips a blob through encode and decode", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const encoded = encodeValue(bytes);
    expect(decodeValue(encoded)).toEqual(bytes);
  });

  test("fails loudly on a value type it does not know", () => {
    expect(() => decodeValue({ type: "quantum" } as never)).toThrow(
      DatabaseError,
    );
  });
});
