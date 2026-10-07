import { expect, test } from "bun:test";
import { ApiError } from "@bunny.net/openapi-client";
import { createToolContext, type LoggingClient } from "../context.ts";
import { pullZonesLogs } from "./logs.ts";

const entry = {
  timestamp: "2026-08-08T14:32:11.265Z",
  pullZoneId: 7,
  requestId: "648fd832dbc1b102134949e15a9fdb2d",
  cacheStatus: "MISS",
  statusCode: 404,
  bytesSent: 1095,
  edgeLocation: "WA",
  scheme: "https",
  host: "example.b-cdn.net",
  path: "/a",
  url: "https://example.b-cdn.net/a",
};

test("pullzones.logs joins list filters and returns the next offset", async () => {
  let query: Record<string, unknown> | undefined;
  const logging = {
    GET: (
      _path: string,
      opts: { params: { query: Record<string, unknown> } },
    ) => {
      query = opts.params.query;
      return Promise.resolve({
        data: {
          data: [entry],
          pagination: { offset: 0, limit: 1, returned: 1, hasMore: true },
          query: { pullZoneId: 7, from: "f", to: "t", order: "desc" },
        },
      });
    },
  } as unknown as LoggingClient;
  const ctx = createToolContext({ clients: { logging } });

  const logs = await pullZonesLogs.invoke(ctx, {
    pullZone: 7,
    from: "2026-08-08T02:00:00+02:00",
    to: "2026-08-09",
    status: ["4xx", "5xx"],
    limit: 1,
  });

  expect(query).toMatchObject({
    from: "2026-08-08T00:00:00Z",
    to: "2026-08-09T00:00:00Z",
    status: "4xx,5xx",
    limit: 1,
    order: "desc",
  });
  expect(logs).toMatchObject({ from: "f", to: "t", nextOffset: 1 });
  expect(logs.entries).toHaveLength(1);
});

test("pullzones.logs explains a 404 as logging being disabled", async () => {
  const logging = {
    GET: () => Promise.reject(new ApiError("Not found.", 404)),
  } as unknown as LoggingClient;
  const ctx = createToolContext({ clients: { logging } });
  await expect(pullZonesLogs.invoke(ctx, { pullZone: 7 })).rejects.toThrow(
    "Logging is not enabled for pull zone 7",
  );
});
