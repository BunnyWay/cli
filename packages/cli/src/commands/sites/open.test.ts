import { expect, test } from "bun:test";
import type { Hostname } from "@/core/hostnames/index.ts";
import { type RemoteSiteState, STATE_VERSION } from "./constants.ts";
import { siteLiveUrl } from "./open.ts";

function state(overrides?: Partial<RemoteSiteState>): RemoteSiteState {
  return {
    version: STATE_VERSION,
    name: "my-site",
    storageZoneId: 10,
    pullZoneId: 30,
    deploys: [],
    ...overrides,
  };
}

const SYSTEM: Hostname = {
  Value: "my-site.b-cdn.net",
  IsSystemHostname: true,
  HasCertificate: true,
} as Hostname;

const CUSTOM: Hostname = {
  Value: "example.com",
  IsSystemHostname: false,
  HasCertificate: true,
  ForceSSL: true,
} as Hostname;

test("siteLiveUrl falls back to the system host when no custom domain", () => {
  expect(siteLiveUrl(state(), [SYSTEM])).toBe("https://my-site.b-cdn.net");
});

test("siteLiveUrl prefers the recorded custom domain", () => {
  expect(siteLiveUrl(state({ domain: "example.com" }), [SYSTEM, CUSTOM])).toBe(
    "https://example.com",
  );
});

test("siteLiveUrl uses the system host when the recorded domain isn't on the zone", () => {
  // The domain was recorded but its hostname was later removed from the zone.
  expect(siteLiveUrl(state({ domain: "gone.example.com" }), [SYSTEM])).toBe(
    "https://my-site.b-cdn.net",
  );
});

test("siteLiveUrl serves the custom domain over http until its cert lands", () => {
  const pending = { ...CUSTOM, HasCertificate: false, ForceSSL: false };
  expect(siteLiveUrl(state({ domain: "example.com" }), [SYSTEM, pending])).toBe(
    "http://example.com",
  );
});

test("siteLiveUrl is undefined when the zone has no hostnames", () => {
  expect(siteLiveUrl(state(), [])).toBeUndefined();
});
