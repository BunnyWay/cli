import { describe, expect, test } from "bun:test";
import { anyResolverPointsAt, type DnsResolver, dnsPointsAt } from "./dns.ts";

const noCname = () => Promise.reject(new Error("ENODATA"));
const noA = () => Promise.reject(new Error("ENOTFOUND"));

function resolver(overrides: Partial<DnsResolver>): DnsResolver {
  return { resolveCname: noCname, resolve4: noA, ...overrides };
}

describe("dnsPointsAt", () => {
  test("matches a CNAME pointing at the target", async () => {
    const r = resolver({
      resolveCname: async () => ["my-script-e9g0r.b-cdn.net"],
    });
    expect(
      await dnsPointsAt("shop.example.com", "my-script-e9g0r.b-cdn.net", r),
    ).toBe(true);
  });

  test("ignores case and trailing dots in CNAME answers", async () => {
    const r = resolver({
      resolveCname: async () => ["My-Script-E9G0R.B-CDN.NET."],
    });
    expect(
      await dnsPointsAt("shop.example.com", "my-script-e9g0r.b-cdn.net", r),
    ).toBe(true);
  });

  test("a CNAME to somewhere else is not a match by itself", async () => {
    const r = resolver({
      resolveCname: async () => ["other.example.net"],
      resolve4: async (host) =>
        host === "my-script-e9g0r.b-cdn.net" ? ["1.1.1.1"] : ["9.9.9.9"],
    });
    expect(
      await dnsPointsAt("shop.example.com", "my-script-e9g0r.b-cdn.net", r),
    ).toBe(false);
  });

  test("falls back to shared A records when no CNAME exists (flattened DNS)", async () => {
    const r = resolver({
      resolve4: async (host) =>
        host === "shop.example.com" ? ["1.1.1.1", "2.2.2.2"] : ["2.2.2.2"],
    });
    expect(
      await dnsPointsAt("shop.example.com", "my-script-e9g0r.b-cdn.net", r),
    ).toBe(true);
  });

  test("returns false when nothing resolves yet", async () => {
    expect(
      await dnsPointsAt(
        "shop.example.com",
        "my-script-e9g0r.b-cdn.net",
        resolver({}),
      ),
    ).toBe(false);
  });

  test("returns false when A records differ", async () => {
    const r = resolver({
      resolve4: async (host) =>
        host === "shop.example.com" ? ["3.3.3.3"] : ["4.4.4.4"],
    });
    expect(
      await dnsPointsAt("shop.example.com", "my-script-e9g0r.b-cdn.net", r),
    ).toBe(false);
  });
});

describe("anyResolverPointsAt", () => {
  const live = resolver({ resolveCname: async () => ["target.b-cdn.net"] });
  const stale = resolver({});

  test("true when any resolver sees the record", async () => {
    expect(
      await anyResolverPointsAt("shop.example.com", "target.b-cdn.net", [
        stale,
        live,
      ]),
    ).toBe(true);
  });

  test("false when no resolver sees the record", async () => {
    expect(
      await anyResolverPointsAt("shop.example.com", "target.b-cdn.net", [
        stale,
        stale,
      ]),
    ).toBe(false);
  });

  test("a resolver that errors entirely doesn't block the others", async () => {
    const broken: DnsResolver = {
      resolveCname: () => Promise.reject(new Error("ETIMEOUT")),
      resolve4: () => Promise.reject(new Error("ETIMEOUT")),
    };
    expect(
      await anyResolverPointsAt("shop.example.com", "target.b-cdn.net", [
        broken,
        live,
      ]),
    ).toBe(true);
  });
});
