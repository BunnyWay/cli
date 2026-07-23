import { expect, test } from "bun:test";
import { createActionContext, type McClient } from "../../context.ts";
import { registryTypeForServer } from "./api.ts";
import {
  registriesCreate,
  registriesDelete,
  registriesList,
  registriesUpdate,
} from "./index.ts";

type Call = [string, string, unknown];

/** Route each method to a handler keyed by method + path template, recording calls. */
function fakeMc(
  responses: Record<string, unknown>,
  calls: Call[] = [],
): { mc: McClient; calls: Call[] } {
  const handler = (method: string) => (path: string, opts: unknown) => {
    calls.push([method, path, opts]);
    return Promise.resolve({ data: responses[`${method} ${path}`] });
  };
  return {
    mc: {
      GET: handler("GET"),
      POST: handler("POST"),
      PUT: handler("PUT"),
      DELETE: handler("DELETE"),
    } as unknown as McClient,
    calls,
  };
}

test("registries.list normalizes the account's registries", async () => {
  const { mc } = fakeMc({
    "GET /registries": {
      items: [
        {
          id: 1155,
          displayName: "ghcr.io (notrab)",
          hostName: "ghcr.io",
          userName: "notrab",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    },
  });
  const ctx = createActionContext({ clients: { mc } });

  expect(await registriesList.invoke(ctx, {})).toEqual([
    {
      id: 1155,
      name: "ghcr.io (notrab)",
      hostname: "ghcr.io",
      username: "notrab",
      createdAt: "2026-01-01T00:00:00Z",
      lastUpdatedAt: null,
    },
  ]);
});

test("registries.create derives the type from the server and reads the record back", async () => {
  const { mc, calls } = fakeMc({
    "POST /registries": { id: 7, status: "saved" },
    "GET /registries/{registryId}": { id: 7, displayName: "gh" },
  });
  const ctx = createActionContext({ clients: { mc } });

  const result = await registriesCreate.invoke(ctx, {
    name: "gh",
    username: "notrab",
    password: "token",
    server: "ghcr.io",
  });

  const post = calls[0]?.[2] as { body: Record<string, unknown> };
  expect(post.body).toMatchObject({ displayName: "gh", type: "gitHub" });
  expect(result).toMatchObject({ id: 7, name: "gh" });
});

test("registries.create surfaces a save failure as a UserError", async () => {
  const { mc } = fakeMc({
    "POST /registries": { status: "secretsValidationFailed" },
  });
  const ctx = createActionContext({ clients: { mc } });

  await expect(
    registriesCreate.invoke(ctx, { name: "x", username: "u", password: "p" }),
  ).rejects.toThrow(/Failed to add registry: secretsValidationFailed/);
});

test("registries.update keeps the existing name and rejects half a credential", async () => {
  const { mc, calls } = fakeMc({
    "GET /registries/{registryId}": { id: 7, displayName: "old-name" },
    "PUT /registries/{registryId}": { id: 7, status: "saved" },
  });
  const ctx = createActionContext({ clients: { mc } });

  await registriesUpdate.invoke(ctx, {
    registry: 7,
    username: "notrab",
    password: "token",
  });
  const put = calls.find(([method]) => method === "PUT")?.[2] as {
    body: Record<string, unknown>;
  };
  expect(put.body).toEqual({
    displayName: "old-name",
    passwordCredentials: { userName: "notrab", password: "token" },
  });

  await expect(
    registriesUpdate.invoke(ctx, { registry: 7, username: "only-user" }),
  ).rejects.toThrow(/rotated together/);
});

test("registries.delete maps inUse and notFound to errors", async () => {
  const inUse = fakeMc({
    "DELETE /registries/{registryId}": {
      status: "inUse",
      applications: ["my-app"],
    },
  });
  const ctx = createActionContext({ clients: { mc: inUse.mc } });
  await expect(registriesDelete.invoke(ctx, { registry: 7 })).rejects.toThrow(
    /in use by one or more apps/,
  );

  const missing = fakeMc({
    "DELETE /registries/{registryId}": { status: "notFound" },
  });
  await expect(
    registriesDelete.invoke(
      createActionContext({ clients: { mc: missing.mc } }),
      {
        registry: 7,
      },
    ),
  ).rejects.toThrow(/not found/);

  const removed = fakeMc({
    "DELETE /registries/{registryId}": { status: "removed" },
  });
  expect(
    await registriesDelete.invoke(
      createActionContext({ clients: { mc: removed.mc } }),
      { registry: 7 },
    ),
  ).toEqual({ id: 7, deleted: true });
});

test("registryTypeForServer knows the hosts that need a type", () => {
  expect(registryTypeForServer("ghcr.io")).toBe("gitHub");
  expect(registryTypeForServer("https://ghcr.io/v2")).toBe("gitHub");
  expect(registryTypeForServer("docker.io")).toBe("dockerHub");
  expect(registryTypeForServer("registry.example.com")).toBeUndefined();
  expect(registryTypeForServer(undefined)).toBeUndefined();
});
