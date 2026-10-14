import { expect, test } from "bun:test";
import { type CoreClient, createToolContext } from "@bunny.net/tools";
import { type PullZoneSource, resolvePullZoneTarget } from "./target.ts";

const ctx = createToolContext({
  clients: {
    core: {
      GET: () =>
        Promise.resolve({ data: [{ Id: 9, Name: "cdn", Enabled: true }] }),
    } as unknown as CoreClient,
  },
});

const source = (linked: boolean, name: string): PullZoneSource => ({
  linked: () => linked,
  resolve: async () => ({ pullZone: 1, name, label: "Site" }),
});

test("an explicit pull zone beats links, and the first linked source wins", async () => {
  const sources = [source(false, "a"), source(true, "b"), source(true, "c")];
  expect(
    await resolvePullZoneTarget(ctx, undefined, "json", sources),
  ).toMatchObject({ name: "b" });
  expect(await resolvePullZoneTarget(ctx, "cdn", "json", sources)).toEqual({
    pullZone: 9,
    name: "cdn",
    label: "Pull zone",
  });
});
