import { describe, expect, test } from "bun:test";
import {
  type ContainerEndpoint,
  collectDeployedEndpoints,
  endpointTarget,
} from "./format.ts";

/** Build a ContainerEndpoint with sane defaults for the fields we don't test. */
function endpoint(over: Partial<ContainerEndpoint>): ContainerEndpoint {
  return {
    id: "ep_1",
    displayName: "cdn",
    publicHost: "",
    type: "cdn",
    isSslEnabled: true,
    pullZoneId: "1",
    portMappings: [],
    ...over,
  };
}

describe("endpointTarget", () => {
  test("cdn endpoint with SSL → https URL", () => {
    expect(
      endpointTarget(endpoint({ type: "cdn", publicHost: "abc.b-cdn.net" })),
    ).toBe("https://abc.b-cdn.net");
  });

  test("cdn endpoint without SSL → http URL", () => {
    expect(
      endpointTarget(
        endpoint({
          type: "cdn",
          publicHost: "abc.b-cdn.net",
          isSslEnabled: false,
        }),
      ),
    ).toBe("http://abc.b-cdn.net");
  });

  test("cdn endpoint with no host yet → undefined (provisioning)", () => {
    expect(endpointTarget(endpoint({ type: "cdn", publicHost: "" }))).toBe(
      undefined,
    );
  });

  test("anycast endpoint → first public IP", () => {
    expect(
      endpointTarget(
        endpoint({
          type: "anycast",
          publicIpAddresses: [
            { address: "203.0.113.5", region: "de" },
            { address: "203.0.113.6", region: "us" },
          ],
        }),
      ),
    ).toBe("203.0.113.5");
  });

  test("publicIp endpoint → first public IP", () => {
    expect(
      endpointTarget(
        endpoint({
          type: "publicIp",
          publicIpAddresses: [{ address: "198.51.100.9", region: "de" }],
        }),
      ),
    ).toBe("198.51.100.9");
  });

  // The common just-deployed case for IP endpoints: the host returns
  // before the IPs are assigned, so we render "provisioning…" rather than
  // a bogus address.
  test("anycast endpoint with no IPs yet → undefined (provisioning)", () => {
    expect(endpointTarget(endpoint({ type: "anycast" }))).toBe(undefined);
    expect(
      endpointTarget(endpoint({ type: "anycast", publicIpAddresses: [] })),
    ).toBe(undefined);
  });
});

describe("collectDeployedEndpoints", () => {
  test("returns [] for an undefined app", () => {
    expect(collectDeployedEndpoints(undefined)).toEqual([]);
  });

  test("flattens endpoints across containers with resolved targets", () => {
    // Minimal app shape — only the fields collectDeployedEndpoints reads.
    const app = {
      containerTemplates: [
        {
          name: "web",
          endpoints: [
            endpoint({
              displayName: "public",
              type: "cdn",
              publicHost: "web.b-cdn.net",
            }),
          ],
        },
        {
          name: "api",
          endpoints: [
            endpoint({
              displayName: "ip",
              type: "anycast",
              publicIpAddresses: [{ address: "203.0.113.5", region: "de" }],
            }),
          ],
        },
      ],
    } as unknown as Parameters<typeof collectDeployedEndpoints>[0];

    expect(collectDeployedEndpoints(app)).toEqual([
      {
        container: "web",
        name: "public",
        type: "cdn",
        target: "https://web.b-cdn.net",
      },
      {
        container: "api",
        name: "ip",
        type: "anycast",
        target: "203.0.113.5",
      },
    ]);
  });
});
