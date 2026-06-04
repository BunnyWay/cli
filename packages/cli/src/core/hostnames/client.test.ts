import { describe, expect, test } from "bun:test";
import { type Hostname, hostnameUrl, toSafeHostname } from "./client.ts";

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
