import { expect, test } from "bun:test";
import { type CoreClient, createToolContext } from "@bunny.net/tools";
import { resolveSitePullZone } from "./site.ts";

const zones = [
  { Id: 1, Name: "sites-blog-abc123", StorageZoneId: 10, Enabled: true },
  { Id: 2, Name: "sites-shop-xyz789", StorageZoneId: 20, Enabled: true },
  // An imported site keeps its own pull zone name.
  { Id: 3, Name: "legacy-cdn", StorageZoneId: 30, Enabled: true },
  { Id: 4, Name: "api", StorageZoneId: null, Enabled: true },
];

const ctx = createToolContext({
  clients: {
    core: {
      GET: () => Promise.resolve({ data: zones }),
    } as unknown as CoreClient,
  },
});

test("resolves a site name to its pull zone", async () => {
  expect(
    await resolveSitePullZone(ctx, { site: "shop", output: "json" }),
  ).toEqual({ name: "shop", pullZone: 2, fromDirectory: false });
});

test("resolves a storage zone ID, including an imported site's", async () => {
  expect(
    await resolveSitePullZone(ctx, { site: "30", output: "json" }),
  ).toMatchObject({ pullZone: 3 });
});

test("an unknown site names the fix", async () => {
  await expect(
    resolveSitePullZone(ctx, { site: "nope", output: "json" }),
  ).rejects.toThrow('No site found for "nope".');
});
