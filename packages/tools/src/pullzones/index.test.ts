import { expect, test } from "bun:test";
import { ApiError } from "@bunny.net/openapi-client";
import { type CoreClient, createToolContext } from "../context.ts";
import { pullZonesCreate, pullZonesGet } from "./index.ts";

test("pullzones.create prepends https:// to a bare origin", async () => {
  let body: unknown;
  const core = {
    POST: (_path: string, opts: { body: unknown }) => {
      body = opts.body;
      return Promise.resolve({
        data: { Id: 7, Name: "my-zone", Enabled: true },
      });
    },
  } as unknown as CoreClient;
  const ctx = createToolContext({ clients: { core } });
  const zone = await pullZonesCreate.invoke(ctx, {
    name: "my-zone",
    origin: "origin.example.com",
  });
  expect(body).toEqual({
    Name: "my-zone",
    OriginUrl: "https://origin.example.com",
  });
  expect(zone).toMatchObject({ id: 7, status: "active" });
});

test("pullzones.get turns a 404 into a not-found error", async () => {
  const core = {
    GET: () => Promise.reject(new ApiError("Not Found", 404)),
  } as unknown as CoreClient;
  const ctx = createToolContext({ clients: { core } });
  await expect(pullZonesGet.invoke(ctx, { pullZone: 9 })).rejects.toThrow(
    "Pull zone 9 not found.",
  );
});
