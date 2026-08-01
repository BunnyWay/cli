import { expect, test } from "bun:test";
import type { CoreClient } from "../../../core/hostnames/index.ts";
import { attachPreviewWildcard } from "./index.ts";

// A minimal core client covering the wildcard-attach calls: addHostname POST, hostname list GET, free-cert GET, force-SSL POST. `hostnames` is what the zone reports back.
function stubClient(opts: {
  failAddHostname?: boolean;
  failSsl?: boolean;
  hostnames?: string[];
}) {
  const hostnames = (opts.hostnames ?? ["*.preview.example.com"]).map(
    (Value) => ({ Value }),
  );
  return {
    POST: async (route: string) => {
      if (route === "/pullzone/{id}/addHostname" && opts.failAddHostname) {
        throw new Error("hostname is already taken");
      }
      return { data: undefined };
    },
    GET: async (route: string) => {
      if (route === "/pullzone/loadFreeCertificate" && opts.failSsl) {
        throw new Error("DNS not pointed yet");
      }
      if (route === "/pullzone/{id}") return { data: { Hostnames: hostnames } };
      return { data: undefined };
    },
  } as unknown as CoreClient;
}

// `state.domain` (the previews-operational signal) keys off this return value, so an attach that leaves no wildcard on the zone must report false.
test("attachPreviewWildcard reports failure when the hostname can't be added", async () => {
  const attached = await attachPreviewWildcard({
    coreClient: stubClient({ failAddHostname: true, hostnames: [] }),
    pullZoneId: 1,
    domain: "example.com",
    json: true,
  });
  expect(attached).toBe(false);
});

// Retrying `domains add` after a failed state write re-adds the wildcard; the API rejects the duplicate, but previews do work, so the retry must reconcile rather than report failure again.
test("attachPreviewWildcard succeeds when the wildcard is already on the zone", async () => {
  const attached = await attachPreviewWildcard({
    coreClient: stubClient({
      failAddHostname: true,
      hostnames: ["example.com", "*.PREVIEW.example.com"],
    }),
    pullZoneId: 1,
    domain: "example.com",
    json: true,
  });
  expect(attached).toBe(true);
});

test("attachPreviewWildcard succeeds once the hostname attaches, even when SSL is still pending", async () => {
  expect(
    await attachPreviewWildcard({
      coreClient: stubClient({}),
      pullZoneId: 1,
      domain: "example.com",
      json: true,
    }),
  ).toBe(true);
  // DNS-01 can't complete before the wildcard record exists; a pending cert must not block previews.
  expect(
    await attachPreviewWildcard({
      coreClient: stubClient({ failSsl: true }),
      pullZoneId: 1,
      domain: "example.com",
      json: true,
    }),
  ).toBe(true);
});
