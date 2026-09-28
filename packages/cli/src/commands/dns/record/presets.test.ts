import { describe, expect, test } from "bun:test";
import { RECORD_TYPES } from "@/core/dns-record-types.ts";
import { findPreset, PRESETS } from "./presets.ts";

const build = (
  id: string,
  params: Record<string, string> = {},
  domain = "example.com",
) => {
  const t = findPreset(id);
  if (!t) throw new Error(`missing preset ${id}`);
  return t.build({ domain, params });
};

describe("DNS presets", () => {
  test("every preset has a unique id and at least one record from defaults", () => {
    const ids = PRESETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of PRESETS) {
      const initial = Object.fromEntries(
        t.params
          .filter((p) => p.initial)
          .map((p) => [p.key, p.initial as string]),
      );
      // Presets with a required param legitimately need it; supply a stub.
      for (const p of t.params)
        if (!p.optional && !initial[p.key]) initial[p.key] = "stub";
      expect(
        t.build({ domain: "example.com", params: initial }).length,
      ).toBeGreaterThan(0);
    }
  });

  test("google-workspace: MX + SPF, DKIM/DMARC only when provided", () => {
    const base = build("google-workspace");
    expect(base).toHaveLength(2);
    expect(base[0]).toMatchObject({
      Type: RECORD_TYPES.MX,
      Name: "",
      Value: "smtp.google.com",
      Priority: 1,
    });
    expect(base[1]?.Value).toBe("v=spf1 include:_spf.google.com ~all");

    const full = build("google-workspace", {
      dkim: "v=DKIM1; p=abc",
      dmarc: "dmarc@example.com",
    });
    expect(full).toHaveLength(4);
    expect(full.find((r) => r.Name === "google._domainkey")?.Value).toBe(
      "v=DKIM1; p=abc",
    );
    expect(full.find((r) => r.Name === "_dmarc")?.Value).toContain(
      "rua=mailto:dmarc@example.com",
    );
  });

  test("microsoft365 derives the MX host from the domain", () => {
    const recs = build("microsoft365", {}, "acme.co.uk");
    expect(recs[0]?.Value).toBe("acme-co-uk.mail.protection.outlook.com");
  });

  test("bluesky writes _atproto at apex or under the handle subdomain", () => {
    expect(build("bluesky", { did: "did:plc:xyz" })[0]).toMatchObject({
      Type: RECORD_TYPES.TXT,
      Name: "_atproto",
      Value: "did=did:plc:xyz",
    });
    expect(
      build("bluesky", { did: "did:plc:xyz", handle: "alice" })[0]?.Name,
    ).toBe("_atproto.alice");
  });

  test("resend puts MX, SPF, and DKIM under the sending subdomain", () => {
    const recs = build("resend", { dkim: "v=DKIM1; p=xyz" });
    expect(recs.find((r) => r.Type === RECORD_TYPES.MX)?.Name).toBe("send");
    expect(recs.find((r) => r.Name === "resend._domainkey.send")?.Value).toBe(
      "v=DKIM1; p=xyz",
    );

    const custom = build("resend", { sub: "mail", dkim: "v=DKIM1; p=xyz" });
    expect(custom.some((r) => r.Name === "resend._domainkey.mail")).toBe(true);
  });

  test("no-email uses a null MX and a reject DMARC", () => {
    const recs = build("no-email");
    expect(recs.find((r) => r.Type === RECORD_TYPES.MX)?.Value).toBe(".");
    expect(recs.find((r) => r.Name === "_dmarc")?.Value).toContain("p=reject");
  });

  test("aliases resolve to the same preset", () => {
    expect(findPreset("outlook")?.id).toBe("microsoft365");
    expect(findPreset("gmail")?.id).toBe("google-workspace");
    expect(findPreset("nope")).toBeUndefined();
  });
});
