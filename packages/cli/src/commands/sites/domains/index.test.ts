import { afterAll, beforeEach, expect, test } from "bun:test";
import type { CoreClient } from "../../../core/hostnames/index.ts";
import { type SiteContext, siteFiles } from "../api.ts";
import { STATE_VERSION } from "../constants.ts";
import { setupSiteDomain } from "./index.ts";

// In-memory storage-file store so recordSiteDomain's state write is observable.
const store = new Map<string, string>();
const original = { ...siteFiles };

beforeEach(() => {
  store.clear();
  siteFiles.connect = (zone) =>
    ({ zoneName: zone.Name }) as unknown as ReturnType<
      typeof siteFiles.connect
    >;
  siteFiles.download = async (_zone, path) => {
    const content = store.get(path);
    if (content === undefined) throw new Error("404 Not Found");
    return {
      stream: new Blob([content]).stream(),
      response: new Response(content),
      length: content.length,
    } as Awaited<ReturnType<typeof siteFiles.download>>;
  };
  siteFiles.upload = async (_zone, path, stream) => {
    store.set(path, await new Response(stream).text());
  };
});

afterAll(() => {
  Object.assign(siteFiles, original);
});

function fakeSite(): SiteContext {
  return {
    state: {
      version: STATE_VERSION,
      name: "my-site",
      storageZoneId: 10,
      pullZoneId: 30,
      scriptId: 20,
      deploys: [],
    },
    etag: "etag",
    storageZone: { Id: 10, Name: "my-site" },
    connection: { zoneName: "my-site" },
  } as unknown as SiteContext;
}

// addHostname POST + the pull-zone hostname read; `attached` controls whether the domain shows on the zone afterwards.
function stubClient(opts: { failAdd?: boolean; attached: boolean }) {
  return {
    POST: async (route: string) => {
      if (route === "/pullzone/{id}/addHostname" && opts.failAdd) {
        throw new Error("hostname is already taken");
      }
      return { data: undefined };
    },
    GET: async () => ({
      data: {
        Hostnames: [
          { IsSystemHostname: true, Value: "my-site.b-cdn.net" },
          ...(opts.attached ? [{ Value: "shop.example.com" }] : []),
        ],
      },
    }),
  } as unknown as CoreClient;
}

test("setupSiteDomain records the domain once the hostname is on the zone", async () => {
  const site = fakeSite();
  await setupSiteDomain({
    coreClient: stubClient({ attached: true }),
    site,
    domain: "shop.example.com",
    interactive: false,
    verbose: false,
    json: true,
  });
  expect(site.state.domain).toBe("shop.example.com");
  expect(store.get("_bunny/site.json")).toContain("shop.example.com");
});

// setupHostname reports an attach failure instead of throwing, so the zone read is the gate: a domain that never attached must not become the production URL.
test("setupSiteDomain doesn't record a domain that never attached", async () => {
  const site = fakeSite();
  await setupSiteDomain({
    coreClient: stubClient({ failAdd: true, attached: false }),
    site,
    domain: "shop.example.com",
    interactive: false,
    verbose: false,
  });
  expect(site.state.domain).toBeUndefined();
  expect(store.has("_bunny/site.json")).toBe(false);
});
