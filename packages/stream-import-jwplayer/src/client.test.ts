import { afterEach, expect, test } from "bun:test";
import type { Logger } from "@bunny.net/stream-import";
import { JWPlayerClient } from "./client.ts";

const silent: Logger = {
  log() {},
  debug() {},
  info() {},
  success() {},
  warn() {},
  error() {},
  dim() {},
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("splits a created-date window at the 10,000 cap and walks each half oldest-first", async () => {
  const queries: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const q = new URL(String(input)).searchParams;
    queries.push(q.get("q") ?? "");
    expect(q.get("sort")).toBe("created:asc");
    // The first, whole-history window is over the cap; each half is small.
    if (queries.length === 1)
      return Response.json({ total: 10_000, media: [] });
    const n = queries.length;
    return Response.json({
      total: 1,
      media: [{ id: `m${n}`, status: "ready", metadata: { title: "" } }],
    });
  }) as unknown as typeof fetch;

  const client = new JWPlayerClient(
    { apiKey: "k", siteId: "s" },
    { userAgent: "test", requestTimeout: 5_000, logger: silent },
  );
  const media = await client.listMedia();

  expect(media.map((m) => m.id)).toEqual(["m2", "m3"]);
  const [, first, second] = queries.map((q) =>
    q.match(/^created:\[(\S+) TO (\S+)\]$/)?.slice(1),
  );
  expect(first?.[0]).toBe("2005-01-01T00:00:00");
  expect(Date.parse(`${second?.[0]}Z`) - Date.parse(`${first?.[1]}Z`)).toBe(
    1000,
  );
});
