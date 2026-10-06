import { expect, test } from "bun:test";
import { resolveVideoInteractive } from "./context.ts";
import { withTTY } from "./test-tty.ts";
import type { StreamClient } from "./videos-api.ts";

function fakeStreamClient(paths: string[]): StreamClient {
  return {
    GET: async (path: string) => {
      paths.push(path);
      return { data: { totalItems: 0, items: [] } };
    },
  } as unknown as StreamClient;
}

// --force must not let a paid or destructive command act on a video nobody named.
test("no GUID errors instead of listing, unattended or under --force", async () => {
  const paths: string[] = [];
  const client = fakeStreamClient(paths);

  await expect(
    resolveVideoInteractive(client, 4321, undefined),
  ).rejects.toThrow("A video is required.");
  await withTTY(() =>
    expect(
      resolveVideoInteractive(client, 4321, undefined, { force: true }),
    ).rejects.toThrow("A video is required."),
  );
  expect(paths).toEqual([]);
});
