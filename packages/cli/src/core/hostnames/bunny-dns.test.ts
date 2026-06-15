import { describe, expect, test } from "bun:test";
import prompts from "prompts";
import { findBunnyDnsZone, offerBunnyDnsRecord } from "./bunny-dns.ts";
import type { CoreClient } from "./client.ts";
import { offerBunnyDnsThenSsl } from "./flow.ts";

type Zone = { Id: number; Domain: string; NameserversDetected?: boolean };
type Rec = { Id?: number; Type?: number; Name?: string; Value?: string };

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
        const zone = zones.find((z) => z.Id === id);
        return {
          data: {
            Records: recordsByZone[id] ?? [],
            NameserversDetected: zone?.NameserversDetected,
          },
        };
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
      7: [{ Id: 99, Type: 0, Name: "www", Value: "1.2.3.4" }],
    });
    const match = await findBunnyDnsZone(client, "shop.example.com");
    expect(match?.existing).toBeNull();
  });

  test("reports delegated:true only when nameservers are detected", async () => {
    const delegated = fakeClient([
      { Id: 7, Domain: "example.com", NameserversDetected: true },
    ]);
    expect(
      (await findBunnyDnsZone(delegated, "shop.example.com"))?.delegated,
    ).toBe(true);

    // A zone in the account but not yet delegated at the registrar isn't live.
    const undelegated = fakeClient([
      { Id: 7, Domain: "example.com", NameserversDetected: false },
    ]);
    expect(
      (await findBunnyDnsZone(undelegated, "shop.example.com"))?.delegated,
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
          existing: { Type: 0, Name: "shop", Value: "1.2.3.4" },
          delegated: true,
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
    const client = fakeClient(
      [{ Id: 7, Domain: "example.com", NameserversDetected: true }],
      { 7: [{ Type: 0, Name: "shop", Value: "1.2.3.4" }] },
    );

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
});
