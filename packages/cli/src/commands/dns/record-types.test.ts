import { describe, expect, test } from "bun:test";
import {
  formatRecordValue,
  parseRecordType,
  RECORD_TYPES,
  recordName,
  recordTypeLabel,
} from "./record-types.ts";

describe("parseRecordType", () => {
  test("parses known types case-insensitively", () => {
    expect(parseRecordType("A")).toBe(RECORD_TYPES.A);
    expect(parseRecordType("cname")).toBe(RECORD_TYPES.CNAME);
    expect(parseRecordType("  Mx ")).toBe(RECORD_TYPES.MX);
  });

  test("throws on an unknown type", () => {
    expect(() => parseRecordType("BOGUS")).toThrow(/Unknown record type/);
  });
});

describe("recordTypeLabel", () => {
  test("maps enum values back to names", () => {
    expect(recordTypeLabel(RECORD_TYPES.A)).toBe("A");
    expect(recordTypeLabel(RECORD_TYPES.CAA)).toBe("CAA");
  });

  test("falls back to UNKNOWN", () => {
    expect(recordTypeLabel(999)).toBe("UNKNOWN");
    expect(recordTypeLabel(null)).toBe("UNKNOWN");
  });
});

describe("recordName", () => {
  test("shows @ for the apex", () => {
    expect(recordName("")).toBe("@");
    expect(recordName(null)).toBe("@");
    expect(recordName("api")).toBe("api");
  });
});

describe("formatRecordValue", () => {
  test("plain value for A", () => {
    expect(
      formatRecordValue({ Type: RECORD_TYPES.A, Value: "198.51.100.1" }),
    ).toBe("198.51.100.1");
  });

  test("priority prefix for MX", () => {
    expect(
      formatRecordValue({
        Type: RECORD_TYPES.MX,
        Value: "mail.example.com",
        Priority: 10,
      }),
    ).toBe("10 mail.example.com");
  });

  test("priority/weight/port for SRV", () => {
    expect(
      formatRecordValue({
        Type: RECORD_TYPES.SRV,
        Value: "sip.example.com",
        Priority: 10,
        Weight: 0,
        Port: 389,
      }),
    ).toBe("10 0 389 sip.example.com");
  });

  test("flags/tag/quoted value for CAA", () => {
    expect(
      formatRecordValue({
        Type: RECORD_TYPES.CAA,
        Value: "letsencrypt.org",
        Flags: 0,
        Tag: "issue",
      }),
    ).toBe('0 issue "letsencrypt.org"');
  });
});
