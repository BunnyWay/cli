import { beforeEach, expect, mock, test } from "bun:test";
import prompts from "prompts";
import type { DelegationStatus } from "../../../core/dns-nameservers.ts";
import type { CoreClient } from "../../../core/hostnames/index.ts";

// Delegation is a live NS lookup; stub it so tests stay hermetic and drive the outcome.
let delegationStatus: DelegationStatus = "bunny";
mock.module("../../../core/dns-nameservers.ts", () => ({
  BUNNY_NAMESERVERS: ["kiki.bunny.net", "coco.bunny.net"],
  expectedNameservers: () => ["kiki.bunny.net", "coco.bunny.net"],
  checkDelegation: async () => ({ status: delegationStatus, resolved: [] }),
}));

const { attachPreviewWildcard } = await import("./index.ts");

beforeEach(() => {
  delegationStatus = "bunny";
});

type Rec = { Id?: number; Type?: number; Name?: string; Value?: string };

// A minimal core client covering the wildcard-attach calls: addHostname POST, hostname list GET, free-cert GET, force-SSL POST, plus the Bunny DNS zone/record routes the interactive path uses. `hostnames` is what the pull zone reports back; `calls` tracks issuance attempts, attach attempts, and DNS record writes.
function stubClient(opts: {
  failAddHostname?: boolean;
  failSsl?: boolean;
  hostnames?: Array<string | { Value: string; HasCertificate?: boolean }>;
  zones?: Array<{ Id: number; Domain: string }>;
  records?: Record<number, Rec[]>;
}) {
  const hostnames = (opts.hostnames ?? ["*.preview.example.com"]).map((h) =>
    typeof h === "string" ? { Value: h } : h,
  );
  const calls = {
    loadFreeCertificate: 0,
    addHostname: 0,
    recordWrites: [] as Rec[],
  };
  const client = {
    POST: async (route: string) => {
      if (route === "/pullzone/{id}/addHostname") {
        calls.addHostname++;
        if (opts.failAddHostname) throw new Error("hostname is already taken");
      }
      return { data: undefined };
    },
    PUT: async (route: string, args: { body: Rec }) => {
      if (route === "/dnszone/{zoneId}/records")
        calls.recordWrites.push(args.body);
      return { data: undefined };
    },
    GET: async (
      route: string,
      args?: { params?: { path?: { id?: number } } },
    ) => {
      if (route === "/pullzone/loadFreeCertificate") {
        calls.loadFreeCertificate++;
        if (opts.failSsl) throw new Error("DNS not pointed yet");
      }
      if (route === "/pullzone/{id}") return { data: { Hostnames: hostnames } };
      if (route === "/dnszone") {
        return { data: { Items: opts.zones ?? [], HasMoreItems: false } };
      }
      if (route === "/dnszone/{id}") {
        const id = args?.params?.path?.id as number;
        return { data: { Records: opts.records?.[id] ?? [] } };
      }
      return { data: undefined };
    },
  } as unknown as CoreClient;
  return { client, calls };
}

// `state.domain` (the previews-operational signal) keys off this return value, so an attach that leaves no wildcard on the zone must report false.
test("attachPreviewWildcard reports failure when the hostname can't be added", async () => {
  const { client } = stubClient({ failAddHostname: true, hostnames: [] });
  const attached = await attachPreviewWildcard({
    coreClient: client,
    pullZoneId: 1,
    domain: "example.com",
    json: true,
  });
  expect(attached).toBe(false);
});

// Retrying `domains add` after a failed state write re-adds the wildcard; the API rejects the duplicate, but previews do work, so the retry must reconcile rather than report failure again.
test("attachPreviewWildcard succeeds when the wildcard is already on the zone", async () => {
  const { client } = stubClient({
    failAddHostname: true,
    hostnames: ["example.com", "*.PREVIEW.example.com"],
  });
  const attached = await attachPreviewWildcard({
    coreClient: client,
    pullZoneId: 1,
    domain: "example.com",
    json: true,
  });
  expect(attached).toBe(true);
});

test("attachPreviewWildcard succeeds once the hostname attaches, even when SSL is still pending", async () => {
  expect(
    await attachPreviewWildcard({
      coreClient: stubClient({}).client,
      pullZoneId: 1,
      domain: "example.com",
      json: true,
    }),
  ).toBe(true);
  // DNS-01 can't complete before the wildcard record exists; a pending cert must not block previews.
  expect(
    await attachPreviewWildcard({
      coreClient: stubClient({ failSsl: true }).client,
      pullZoneId: 1,
      domain: "example.com",
      json: true,
    }),
  ).toBe(true);
});

// A retry on a fully set-up wildcard must not re-issue (or report HTTPS as pending when it isn't).
test("attachPreviewWildcard skips issuance when the wildcard already has a certificate", async () => {
  const { client, calls } = stubClient({
    failAddHostname: true,
    failSsl: true,
    hostnames: [{ Value: "*.preview.example.com", HasCertificate: true }],
  });
  const attached = await attachPreviewWildcard({
    coreClient: client,
    pullZoneId: 1,
    domain: "example.com",
    json: true,
  });
  expect(attached).toBe(true);
  expect(calls.loadFreeCertificate).toBe(0);
});

// The API validates a wildcard against live DNS at attach time, so on a Bunny-managed zone the record must be written (confirmed) before addHostname runs.
test("interactive attach creates the wildcard CNAME on Bunny DNS before attaching", async () => {
  prompts.inject([true]);
  const { client, calls } = stubClient({
    zones: [{ Id: 7, Domain: "example.com" }],
  });
  const attached = await attachPreviewWildcard({
    coreClient: client,
    pullZoneId: 1,
    domain: "example.com",
    cnameTarget: "site.b-cdn.net",
    interactive: true,
  });
  expect(attached).toBe(true);
  expect(calls.recordWrites).toEqual([
    { Type: 2, Name: "*.preview", Value: "site.b-cdn.net" },
  ]);
  expect(calls.addHostname).toBe(1);
});

test("interactive attach skips the doomed API call when the DNS write is declined", async () => {
  prompts.inject([false]);
  const { client, calls } = stubClient({
    zones: [{ Id: 7, Domain: "example.com" }],
  });
  const attached = await attachPreviewWildcard({
    coreClient: client,
    pullZoneId: 1,
    domain: "example.com",
    cnameTarget: "site.b-cdn.net",
    interactive: true,
  });
  expect(attached).toBe(false);
  expect(calls.recordWrites).toEqual([]);
  expect(calls.addHostname).toBe(0);
});

// Records on an undelegated zone never resolve publicly, so the wildcard can't validate; don't write records or attempt the attach.
test("interactive attach short-circuits when the zone isn't delegated", async () => {
  delegationStatus = "other";
  const { client, calls } = stubClient({
    zones: [{ Id: 7, Domain: "example.com" }],
  });
  const attached = await attachPreviewWildcard({
    coreClient: client,
    pullZoneId: 1,
    domain: "example.com",
    cnameTarget: "site.b-cdn.net",
    interactive: true,
  });
  expect(attached).toBe(false);
  expect(calls.recordWrites).toEqual([]);
  expect(calls.addHostname).toBe(0);
});

// A record that already routes here needs no prompt and no rewrite; the attach proceeds directly.
test("interactive attach reuses an existing wildcard CNAME without prompting", async () => {
  const { client, calls } = stubClient({
    zones: [{ Id: 7, Domain: "example.com" }],
    records: {
      7: [{ Id: 9, Type: 2, Name: "*.preview", Value: "site.b-cdn.net" }],
    },
  });
  const attached = await attachPreviewWildcard({
    coreClient: client,
    pullZoneId: 1,
    domain: "example.com",
    cnameTarget: "site.b-cdn.net",
    interactive: true,
  });
  expect(attached).toBe(true);
  expect(calls.recordWrites).toEqual([]);
  expect(calls.addHostname).toBe(1);
});
