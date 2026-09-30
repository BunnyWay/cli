import { expect, test } from "bun:test";
import { withTTY } from "@/commands/stream/test-tty.ts";
import type { StreamClient } from "@/commands/stream/videos-api.ts";
import { resolveCollectionInteractive } from "./interactive.ts";

function fakeStreamClient(paths: string[]): StreamClient {
  return {
    GET: async (path: string) => {
      paths.push(path);
      return { data: { totalItems: 0, items: [] } };
    },
  } as unknown as StreamClient;
}

// --force must not let a destructive command delete a collection nobody named.
test("no ID errors instead of listing, unattended or under --force", async () => {
  const paths: string[] = [];
  const client = fakeStreamClient(paths);

  await expect(
    resolveCollectionInteractive(client, 4321, undefined),
  ).rejects.toThrow("A collection is required.");
  await withTTY(() =>
    expect(
      resolveCollectionInteractive(client, 4321, undefined, { force: true }),
    ).rejects.toThrow("A collection is required."),
  );
  expect(paths).toEqual([]);
});
