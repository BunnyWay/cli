import { describe, expect, test } from "bun:test";
import {
  addHostname,
  type CoreClient,
  type Hostname,
  hostnameUrl,
  toSafeHostname,
} from "./client.ts";

describe("hostnameUrl", () => {
  test("respects an existing scheme", () => {
    expect(hostnameUrl("https://x.bunny.run")).toBe("https://x.bunny.run");
    expect(hostnameUrl("http://x.bunny.run")).toBe("http://x.bunny.run");
  });

  test("defaults bare hostnames to http when SSL state is unknown", () => {
    expect(hostnameUrl("shop.example.com")).toBe("http://shop.example.com");
  });

  test("derives https from a certificate", () => {
    expect(hostnameUrl("shop.example.com", { hasCertificate: true })).toBe(
      "https://shop.example.com",
    );
  });

  test("derives https from force SSL when no certificate flag is set", () => {
    expect(hostnameUrl("shop.example.com", { forceSSL: true })).toBe(
      "https://shop.example.com",
    );
  });

  test("a present certificate flag wins over forceSSL", () => {
    expect(
      hostnameUrl("shop.example.com", {
        hasCertificate: false,
        forceSSL: true,
      }),
    ).toBe("http://shop.example.com");
  });
});

describe("toSafeHostname", () => {
  const raw: Hostname = {
    Id: 1,
    Value: "shop.example.com",
    ForceSSL: true,
    IsSystemHostname: false,
    IsManagedHostname: false,
    HasCertificate: true,
    Certificate: "BASE64-CERT",
    CertificateKey: "BASE64-PRIVATE-KEY",
  };

  test("drops Certificate and CertificateKey", () => {
    const safe = toSafeHostname(raw);
    expect("Certificate" in safe).toBe(false);
    expect("CertificateKey" in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain("PRIVATE-KEY");
  });

  test("keeps the non-sensitive display fields", () => {
    expect(toSafeHostname(raw)).toMatchObject({
      Id: 1,
      Value: "shop.example.com",
      ForceSSL: true,
      IsSystemHostname: false,
      HasCertificate: true,
    });
  });
});

describe("addHostname", () => {
  // POST rejects, GET reports what the zone serves.
  const stubClient = (opts: { fail?: boolean; hostnames: string[] }) =>
    ({
      POST: async () => {
        if (opts.fail) throw new Error("hostname is already taken");
        return { data: undefined };
      },
      GET: async () => ({
        data: {
          Hostnames: opts.hostnames.map((Value) => ({
            Value,
            IsSystemHostname: Value.endsWith(".b-cdn.net"),
          })),
        },
      }),
    }) as unknown as CoreClient;

  test("reports a fresh add", async () => {
    const result = await addHostname(
      stubClient({ hostnames: ["site.b-cdn.net", "shop.example.com"] }),
      1,
      "shop.example.com",
    );
    expect(result.alreadyAttached).toBe(false);
    expect(result.cnameTarget).toBe("site.b-cdn.net");
  });

  // Retries after a partial setup re-add an existing hostname; follow-up steps (companion wildcard, state record) must still run, so this is not a failure.
  test("treats a rejected duplicate that the zone serves as already attached", async () => {
    const result = await addHostname(
      stubClient({
        fail: true,
        hostnames: ["site.b-cdn.net", "SHOP.example.com"],
      }),
      1,
      "shop.example.com",
    );
    expect(result.alreadyAttached).toBe(true);
    expect(result.cnameTarget).toBe("site.b-cdn.net");
  });

  test("rethrows when the rejected hostname is not on the zone", async () => {
    expect(
      addHostname(
        stubClient({ fail: true, hostnames: ["site.b-cdn.net"] }),
        1,
        "shop.example.com",
      ),
    ).rejects.toThrow("hostname is already taken");
  });
});
