import { expect, test } from "bun:test";
import { type CoreClient, createActionContext } from "../../context.ts";
import { toAddRecordModel } from "./model.ts";
import {
  dnsRecordsCreate,
  dnsRecordsDelete,
  dnsRecordsUpdate,
} from "./records.ts";
import { dnsZonesDelete, dnsZonesList } from "./zones.ts";

type Call = [string, string, unknown];

/** Route each method to a handler keyed by method + path template, recording calls. */
function fakeCore(
  responses: Record<string, unknown>,
  calls: Call[] = [],
): { core: CoreClient; calls: Call[] } {
  const handler = (method: string) => (path: string, opts: unknown) => {
    calls.push([method, path, opts]);
    return Promise.resolve({ data: responses[`${method} ${path}`] });
  };
  return {
    core: {
      GET: handler("GET"),
      POST: handler("POST"),
      PUT: handler("PUT"),
      DELETE: handler("DELETE"),
    } as unknown as CoreClient,
    calls,
  };
}

const zone = {
  Id: 5,
  Domain: "example.com",
  DnsSecEnabled: true,
  LoggingEnabled: false,
  NameserversDetected: true,
  Records: [
    {
      Id: 11,
      Type: 4,
      Name: "",
      Value: "mail.example.com",
      Priority: 10,
      Ttl: 300,
      Disabled: false,
    },
  ],
};

test("dns.zones.list normalizes zones and skips delegation checks by default", async () => {
  const { core } = fakeCore({
    "GET /dnszone": { Items: [zone], HasMoreItems: false },
  });
  const ctx = createActionContext({ clients: { core } });

  const zones = await dnsZonesList.invoke(ctx, {});
  expect(zones).toHaveLength(1);
  expect(zones[0]).toMatchObject({
    id: 5,
    domain: "example.com",
    recordCount: 1,
    dnssecEnabled: true,
    nameserversDetected: true,
    nameservers: ["kiki.bunny.net", "coco.bunny.net"],
  });
  expect(zones[0]?.delegation).toBeUndefined();
});

test("dns.zones.delete resolves the zone and reports what was removed", async () => {
  const { core, calls } = fakeCore({
    "GET /dnszone/{id}": zone,
  });
  const ctx = createActionContext({ clients: { core } });

  const result = await dnsZonesDelete.invoke(ctx, { zone: "5" });
  expect(result).toEqual({
    id: 5,
    domain: "example.com",
    recordCount: 1,
    deleted: true,
  });
  expect(calls.some(([m, p]) => m === "DELETE" && p === "/dnszone/{id}")).toBe(
    true,
  );
});

test("dns.records.create maps flat fields to the API body per type", async () => {
  const { core, calls } = fakeCore({
    "GET /dnszone/{id}": zone,
    "PUT /dnszone/{zoneId}/records": { Id: 99 },
  });
  const ctx = createActionContext({ clients: { core } });

  const record = await dnsRecordsCreate.invoke(ctx, {
    zone: "5",
    type: "A",
    name: "api",
    value: "198.51.100.1",
    ttl: 300,
  });

  const put = calls.find(([m]) => m === "PUT")?.[2] as {
    body: Record<string, unknown>;
  };
  expect(put.body).toMatchObject({
    Type: 0,
    Name: "api",
    Value: "198.51.100.1",
  });
  expect(record).toMatchObject({
    id: 99,
    type: "A",
    name: "api",
    zoneId: 5,
    domain: "example.com",
  });
});

test("dns.records.update seeds the body from the existing record", async () => {
  const { core, calls } = fakeCore({
    "GET /dnszone/{id}": zone,
    "POST /dnszone/{zoneId}/records/{id}": {},
  });
  const ctx = createActionContext({ clients: { core } });

  const record = await dnsRecordsUpdate.invoke(ctx, {
    zone: "5",
    record: 11,
    changes: { ttl: 3600 },
  });

  const post = calls.find(([m]) => m === "POST")?.[2] as {
    body: Record<string, unknown>;
  };
  // The unchanged value and priority ride along so the API doesn't blank them.
  expect(post.body).toMatchObject({
    Value: "mail.example.com",
    Priority: 10,
    Ttl: 3600,
  });
  expect(record).toMatchObject({ id: 11, ttl: 3600, priority: 10 });
});

test("dns.records.delete rejects an unknown record id", async () => {
  const { core } = fakeCore({ "GET /dnszone/{id}": zone });
  const ctx = createActionContext({ clients: { core } });

  expect(
    dnsRecordsDelete.invoke(ctx, { zone: "5", record: 404 }),
  ).rejects.toThrow("Record 404 not found");
});

test("toAddRecordModel enforces per-type required fields", () => {
  expect(() =>
    toAddRecordModel({ type: "CAA", name: "@", value: "letsencrypt.org" }),
  ).toThrow("CAA records require a value and tag.");
  expect(() => toAddRecordModel({ type: "PZ", name: "@" })).toThrow(
    "PZ records require pullZoneId.",
  );
  expect(() => toAddRecordModel({ type: "nope", name: "@" })).toThrow(
    'Unknown record type "nope".',
  );
  expect(
    toAddRecordModel({ type: "mx", name: "@", value: "mail.example.com" }),
  ).toMatchObject({
    Type: 4,
    Name: "",
    Value: "mail.example.com",
    Priority: 0,
  });
});
