import { expect, test } from "bun:test";
import { createActionContext, type DbClient } from "../../context.ts";
import { dbDelete } from "./lifecycle.ts";
import { dbRegionsSet } from "./regions.ts";
import { dbTokensCreate, dbTokensInvalidate } from "./tokens.ts";

type Call = [string, unknown];

/** Route each method to a handler keyed by the path template, recording calls. */
function fakeDb(
  responses: Record<string, unknown>,
  calls: Call[] = [],
): { db: DbClient; calls: Call[] } {
  const handler = (path: string, opts: unknown) => {
    calls.push([path, opts]);
    return Promise.resolve({ data: responses[path] });
  };
  return {
    db: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
    } as unknown as DbClient,
    calls,
  };
}

const REGION_CONFIG = {
  primary_regions: [{ id: "FR", name: "Paris" }],
  replica_regions: [{ id: "UK", name: "London" }],
  storage_region_available: [],
};

test("db.regions.set writes the exact set and names the result", async () => {
  const { db, calls } = fakeDb({
    "/v2/databases/{db_id}": {
      db: { primary_regions: ["FR"], replicas_regions: ["UK"] },
    },
    "/v1/config": REGION_CONFIG,
  });
  const ctx = createActionContext({ clients: { db } });

  const result = await dbRegionsSet.invoke(ctx, {
    database: "db_1",
    primaryRegions: ["FR"],
    replicaRegions: ["UK"],
  });

  const patch = calls[0]?.[1] as { body: Record<string, unknown> };
  expect(patch.body).toEqual({
    primary_regions: ["FR"],
    replicas_regions: ["UK"],
  });
  expect(result.primary).toEqual([{ code: "FR", name: "Paris" }]);
  expect(result.replica).toEqual([{ code: "UK", name: "London" }]);
});

test("db.regions.set requires at least one primary region", async () => {
  const { db } = fakeDb({});
  const ctx = createActionContext({ clients: { db } });

  await expect(
    dbRegionsSet.invoke(ctx, { database: "db_1", primaryRegions: [] }),
  ).rejects.toThrow(/Invalid input for "db.regions.set"/);
});

test("db.delete reads the database first so callers can clean up .env", async () => {
  const { db, calls } = fakeDb({
    "/v2/databases/{db_id}": {
      db: { id: "db_1", name: "my-app", url: "libsql://my-app" },
    },
  });
  const ctx = createActionContext({ clients: { db } });

  const result = await dbDelete.invoke(ctx, { database: "db_1" });

  expect(result).toEqual({
    id: "db_1",
    name: "my-app",
    url: "libsql://my-app",
    deleted: true,
  });
  expect(calls.map(([path]) => path)).toEqual([
    "/v2/databases/{db_id}",
    "/v2/databases/{db_id}",
  ]);
});

test("db.tokens.create is sensitive and returns the token plus db url", async () => {
  const { db } = fakeDb({
    "/v2/databases/{db_id}/auth/generate": {
      token: "tok_secret",
      expires_at: null,
    },
    "/v2/databases/{db_id}": { db: { id: "db_1", url: "libsql://my-app" } },
  });
  const ctx = createActionContext({ clients: { db } });

  expect(dbTokensCreate.sensitive).toBe(true);
  expect(await dbTokensCreate.invoke(ctx, { database: "db_1" })).toEqual({
    database: "db_1",
    token: "tok_secret",
    authorization: "full-access",
    expiresAt: null,
    databaseUrl: "libsql://my-app",
  });
});

test("db.tokens.invalidate revokes without reading anything back", async () => {
  const { db, calls } = fakeDb({});
  const ctx = createActionContext({ clients: { db } });

  expect(await dbTokensInvalidate.invoke(ctx, { database: "db_1" })).toEqual({
    database: "db_1",
    invalidated: true,
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[0]).toBe("/v2/databases/{db_id}/auth/revoke");
});
