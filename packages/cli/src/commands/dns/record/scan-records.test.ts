import { describe, expect, mock, test } from "bun:test";
import { RECORD_TYPES } from "../../../core/dns-record-types.ts";
import type { DnsDiscoveredRecord } from "../api.ts";

let discovered: DnsDiscoveredRecord[] = [];
mock.module("../api.ts", () => ({
  scanZoneRecords: async () => discovered,
}));

const { discoverImportableRecords } = await import("./scan-records.ts");

const SOA = 16;
const zone = {
  Id: 1,
  Domain: "example.com",
  Records: [{ Type: RECORD_TYPES.A, Name: "dup", Value: "192.0.2.4" }],
} as never;

describe("discoverImportableRecords", () => {
  test("maps apex, drops SOA/NS, and skips records that already exist", async () => {
    discovered = [
      { Type: RECORD_TYPES.A, Name: "@", Value: "192.0.2.1", Ttl: 300 },
      { Type: RECORD_TYPES.CNAME, Name: "www", Value: "example.com" },
      {
        Type: RECORD_TYPES.MX,
        Name: "@",
        Value: "mail.example.com",
        Priority: 10,
      },
      { Type: SOA, Name: "@", Value: "ns root soa" },
      { Type: RECORD_TYPES.NS, Name: "@", Value: "ns1.other.com" },
      { Type: RECORD_TYPES.A, Name: "dup", Value: "192.0.2.4" },
    ];

    const records = await discoverImportableRecords({} as never, zone);

    // SOA, NS, and the already-present "dup" record are filtered out.
    expect(records).toHaveLength(3);
    // Apex "@" is rewritten to the API's empty name.
    const apex = records.find((r) => r.Type === RECORD_TYPES.A);
    expect(apex?.Name).toBe("");
    expect(apex?.Ttl).toBe(300);
    expect(records.find((r) => r.Type === RECORD_TYPES.MX)?.Priority).toBe(10);
    expect(records.some((r) => r.Type === RECORD_TYPES.NS)).toBe(false);
    expect(records.some((r) => r.Value === "ns root soa")).toBe(false);
    expect(records.some((r) => r.Name === "dup")).toBe(false);
  });

  test("passes through CAA Flags/Tag the scan already broke out", async () => {
    discovered = [
      {
        Type: RECORD_TYPES.CAA,
        Name: "@",
        Value: "letsencrypt.org",
        Flags: 0,
        Tag: "issue",
      },
    ];
    const [caa] = await discoverImportableRecords({} as never, zone);
    expect(caa?.Flags).toBe(0);
    expect(caa?.Tag).toBe("issue");
    expect(caa?.Value).toBe("letsencrypt.org");
  });

  test("reconstructs CAA Flags/Tag from rdata when the scan didn't break them out", async () => {
    discovered = [
      { Type: RECORD_TYPES.CAA, Name: "@", Value: '0 issue "letsencrypt.org"' },
    ];
    const [caa] = await discoverImportableRecords({} as never, zone);
    expect(caa?.Flags).toBe(0);
    expect(caa?.Tag).toBe("issue");
    expect(caa?.Value).toBe("letsencrypt.org");
  });

  test("keeps delegated subdomain NS records but drops the apex NS", async () => {
    discovered = [
      { Type: RECORD_TYPES.NS, Name: "@", Value: "kiki.bunny.net" },
      { Type: RECORD_TYPES.NS, Name: "dev", Value: "ns1.vendor.com" },
    ];
    const records = await discoverImportableRecords({} as never, zone);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      Type: RECORD_TYPES.NS,
      Name: "dev",
      Value: "ns1.vendor.com",
    });
  });

  test("treats records differing only by a type-specific field as distinct", async () => {
    const mxZone = {
      Id: 1,
      Domain: "example.com",
      Records: [
        {
          Type: RECORD_TYPES.MX,
          Name: "",
          Value: "mail.example.com",
          Priority: 10,
        },
      ],
    } as never;
    discovered = [
      {
        Type: RECORD_TYPES.MX,
        Name: "@",
        Value: "mail.example.com",
        Priority: 10,
      },
      {
        Type: RECORD_TYPES.MX,
        Name: "@",
        Value: "mail.example.com",
        Priority: 20,
      },
    ];
    const records = await discoverImportableRecords({} as never, mxZone);
    expect(records).toHaveLength(1);
    expect(records[0]?.Priority).toBe(20);
  });

  test("dedupes values that differ only by a trailing dot", async () => {
    const cnameZone = {
      Id: 1,
      Domain: "example.com",
      Records: [
        { Type: RECORD_TYPES.CNAME, Name: "www", Value: "example.com" },
      ],
    } as never;
    discovered = [
      { Type: RECORD_TYPES.CNAME, Name: "www", Value: "example.com." },
    ];
    expect(
      await discoverImportableRecords({} as never, cnameZone),
    ).toHaveLength(0);
  });

  test("reconstructs CAA records with non-standard tags from rdata", async () => {
    discovered = [
      { Type: RECORD_TYPES.CAA, Name: "@", Value: '0 issuevmc "example.com"' },
    ];
    const [caa] = await discoverImportableRecords({} as never, zone);
    expect(caa?.Tag).toBe("issuevmc");
    expect(caa?.Value).toBe("example.com");
  });

  test("returns nothing when the scan only finds existing/zone-managed records", async () => {
    discovered = [
      { Type: RECORD_TYPES.NS, Name: "@", Value: "ns1.other.com" },
      { Type: SOA, Name: "@", Value: "soa" },
      { Type: RECORD_TYPES.A, Name: "dup", Value: "192.0.2.4" },
    ];
    expect(await discoverImportableRecords({} as never, zone)).toHaveLength(0);
  });
});
