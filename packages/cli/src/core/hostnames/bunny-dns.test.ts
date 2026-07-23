import { beforeEach, describe, expect, mock, test } from "bun:test";
import prompts from "prompts";
import type { DelegationStatus } from "../dns-nameservers.ts";

// Delegation is a live NS lookup; stub it so tests stay hermetic and drive the outcome.
let delegationStatus: DelegationStatus = "bunny";
mock.module("../dns-nameservers.ts", () => ({
  BUNNY_NAMESERVERS: ["kiki.bunny.net", "coco.bunny.net"],
  expectedNameservers: () => ["kiki.bunny.net", "coco.bunny.net"],
  checkDelegation: async () => ({ status: delegationStatus, resolved: [] }),
}));

const { findBunnyDnsZone, offerBunnyDnsRecord } = await import(
  "./bunny-dns.ts"
);
const { offerBunnyDnsThenSsl } = await import("./flow.ts");
type CoreClient = import("./client.ts").CoreClient;

type Zone = { Id: number; Domain: string };
type Rec = { Id?: number; Type?: number; Name?: string; Value?: string };

beforeEach(() => {
  delegationStatus = "bunny";
});

/** A core client stubbed to serve a fixed set of zones and per-zone records. */
function fakeClient(
  zones: Zone[],
  recordsByZone: Record<number, Rec[]> = {},
): CoreClient {
  return {
    GET: async (path: string, opts: { params: { path?: { id: number } } }) => {
      if (path === "/dnszone") {
        return { data: { Items: zones, HasMoreItems: false } };
      }
      if (path === "/dnszone/{id}") {
        const id = opts.params.path?.id as number;
        return { data: { Records: recordsByZone[id] ?? [] } };
      }
      throw new Error(`unexpected GET ${path}`);
    },
  } as unknown as CoreClient;
}

describe("findBunnyDnsZone", () => {
  test("returns null when no zone owns the hostname", async () => {
    const client = fakeClient([{ Id: 1, Domain: "other.net" }]);
    expect(await findBunnyDnsZone(client, "shop.example.com")).toBeNull();
  });

  test("matches a subdomain to its zone and derives the record name", async () => {
    const client = fakeClient([{ Id: 7, Domain: "example.com" }]);
    const match = await findBunnyDnsZone(client, "shop.example.com");
    expect(match).toMatchObject({
      zoneId: 7,
      zoneDomain: "example.com",
      recordName: "shop",
      existing: null,
    });
  });

  test("matches the apex with an empty record name", async () => {
    const client = fakeClient([{ Id: 7, Domain: "example.com" }]);
    const match = await findBunnyDnsZone(client, "example.com");
    expect(match?.recordName).toBe("");
  });

  test("prefers the longest matching zone suffix", async () => {
    const client = fakeClient([
      { Id: 1, Domain: "example.com" },
      { Id: 2, Domain: "uk.example.com" },
    ]);
    const match = await findBunnyDnsZone(client, "shop.uk.example.com");
    expect(match).toMatchObject({ zoneId: 2, recordName: "shop" });
  });

  test("ignores case and trailing dots in the hostname", async () => {
    const client = fakeClient([{ Id: 7, Domain: "example.com" }]);
    const match = await findBunnyDnsZone(client, "Shop.Example.COM.");
    expect(match).toMatchObject({ zoneId: 7, recordName: "shop" });
  });

  test("surfaces the record already sitting at that name", async () => {
    const client = fakeClient([{ Id: 7, Domain: "example.com" }], {
      7: [{ Id: 99, Type: 7, Name: "shop", Value: "12345" }],
    });
    const match = await findBunnyDnsZone(client, "shop.example.com");
    expect(match?.existing).toMatchObject({ Id: 99, Type: 7, Value: "12345" });
  });

  test("leaves existing null when no record matches the name", async () => {
    const client = fakeClient([{ Id: 7, Domain: "example.com" }], {
      7: [{ Id: 99, Type: 0, Name: "www", Value: "192.0.2.4" }],
    });
    const match = await findBunnyDnsZone(client, "shop.example.com");
    expect(match?.existing).toBeNull();
  });

  test("reports delegated:true only when the registrar delegates to bunny", async () => {
    const client = fakeClient([{ Id: 7, Domain: "example.com" }]);

    delegationStatus = "bunny";
    expect(
      (await findBunnyDnsZone(client, "shop.example.com"))?.delegated,
    ).toBe(true);

    // A zone in the account but not yet delegated at the registrar isn't live.
    delegationStatus = "other";
    expect(
      (await findBunnyDnsZone(client, "shop.example.com"))?.delegated,
    ).toBe(false);
  });
});

describe("offerBunnyDnsRecord", () => {
  test("throws instead of repointing a record that has no ID", async () => {
    // A record missing an Id would otherwise produce a `.../records/undefined` request.
    prompts.inject([true]);
    const client = {
      POST: async () => {
        throw new Error("repoint must not be attempted without a record ID");
      },
    } as unknown as CoreClient;

    await expect(
      offerBunnyDnsRecord({
        client,
        hostname: "shop.example.com",
        pullZoneId: 12345,
        match: {
          zoneId: 7,
          zoneDomain: "example.com",
          recordName: "shop",
          existing: { Type: 0, Name: "shop", Value: "192.0.2.4" },
          delegated: true,
          nameservers: ["kiki.bunny.net", "coco.bunny.net"],
        },
      }),
    ).rejects.toThrow(/has no ID/);
  });
});

describe("offerBunnyDnsThenSsl", () => {
  test("surfaces a post-confirmation error instead of swallowing it as a detection hiccup", async () => {
    // Zone detection succeeds, but the matched record has no Id — once the user
    // confirms the repoint, the failure must propagate, not fall back to manual DNS.
    prompts.inject([true]);
    const client = fakeClient([{ Id: 7, Domain: "example.com" }], {
      7: [{ Type: 0, Name: "shop", Value: "192.0.2.4" }],
    });

    await expect(
      offerBunnyDnsThenSsl({
        coreClient: client,
        hostname: "shop.example.com",
        pullZoneId: 12345,
        cnameTarget: "shop.b-cdn.net",
        forceSsl: true,
        sslHint: "bunny scripts domains ssl shop.example.com",
        verbose: false,
      }),
    ).rejects.toThrow(/has no ID/);
  });

  test("adds the record but skips the poll when the zone isn't delegated", async () => {
    // A PULLZONE record on an undelegated zone never resolves publicly — short-circuit
    // rather than entering offerDnsWaitAndSsl, which would poll for the full 10 minutes.
    prompts.inject([true]);
    delegationStatus = "other";
    let putCalled = false;
    const client = {
      GET: async (path: string) => {
        if (path === "/dnszone") {
          return {
            data: {
              Items: [{ Id: 7, Domain: "example.com" }],
              HasMoreItems: false,
            },
          };
        }
        if (path === "/dnszone/{id}") {
          return { data: { Records: [] } };
        }
        throw new Error(`unexpected GET ${path}`);
      },
      PUT: async () => {
        putCalled = true;
        return {};
      },
    } as unknown as CoreClient;

    const issued = await offerBunnyDnsThenSsl({
      coreClient: client,
      hostname: "shop.example.com",
      pullZoneId: 12345,
      cnameTarget: "shop.b-cdn.net",
      forceSsl: true,
      sslHint: "bunny scripts domains ssl shop.example.com",
      verbose: false,
    });

    expect(putCalled).toBe(true); // the record was added
    expect(issued).toBe(false); // but no certificate / poll — short-circuited on delegation
  });
});
