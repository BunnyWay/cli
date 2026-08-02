import { expect, test } from "bun:test";
import type { CoreClient } from "../../../core/hostnames/index.ts";
import { attachPreviewWildcard } from "./index.ts";

// A minimal core client covering the wildcard-attach calls: addHostname POST, hostname list GET, free-cert GET, force-SSL POST. `hostnames` is what the zone reports back; `calls` counts certificate issuance attempts.
function stubClient(opts: {
  failAddHostname?: boolean;
  failSsl?: boolean;
  hostnames?: Array<string | { Value: string; HasCertificate?: boolean }>;
}) {
  const hostnames = (opts.hostnames ?? ["*.preview.example.com"]).map((h) =>
    typeof h === "string" ? { Value: h } : h,
  );
  const calls = { loadFreeCertificate: 0 };
  const client = {
    POST: async (route: string) => {
      if (route === "/pullzone/{id}/addHostname" && opts.failAddHostname) {
        throw new Error("hostname is already taken");
      }
      return { data: undefined };
    },
    GET: async (route: string) => {
      if (route === "/pullzone/loadFreeCertificate") {
        calls.loadFreeCertificate++;
        if (opts.failSsl) throw new Error("DNS not pointed yet");
      }
      if (route === "/pullzone/{id}") return { data: { Hostnames: hostnames } };
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
