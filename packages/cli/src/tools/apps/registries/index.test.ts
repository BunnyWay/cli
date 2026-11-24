import { expect, test } from "bun:test";
import { createToolContext, type McClient } from "@/tools/context.ts";
import { registryTypeForServer } from "./api.ts";
import { registriesDelete, registriesUpdate } from "./index.ts";

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

test("registryTypeForServer knows the hosts that need a type", () => {
  expect(registryTypeForServer("ghcr.io")).toBe("gitHub");
  expect(registryTypeForServer("https://ghcr.io/v2")).toBe("gitHub");
  expect(registryTypeForServer("docker.io")).toBe("dockerHub");
  expect(registryTypeForServer("ghcr.io.example.com")).toBeUndefined();
  expect(registryTypeForServer("registry.example.com")).toBeUndefined();
  expect(registryTypeForServer(undefined)).toBeUndefined();
});

test("a registry bunny.net provides cannot be removed or updated", async () => {
  const { mc } = fakeMc({
    "GET /registries/{registryId}": {
      id: 9808,
      displayName: "Bunny Container Registry",
      isPlatformManaged: true,
    },
  });
  const ctx = createToolContext({ clients: { mc } });

  expect(registriesDelete.invoke(ctx, { registry: 9808 })).rejects.toThrow(
    /provided by bunny\.net/,
  );
  expect(
    registriesUpdate.invoke(ctx, { registry: 9808, name: "mine" }),
  ).rejects.toThrow(/provided by bunny\.net/);
});

test("registryTypeForServer scans the host and shrugs off pathological input", () => {
  expect(registryTypeForServer("ghcr.io:443/notrab/app")).toBe("gitHub");
  expect(registryTypeForServer("HTTPS://GHCR.IO/v2")).toBe("gitHub");

  const start = performance.now();
  expect(registryTypeForServer("/".repeat(200_000))).toBeUndefined();
  expect(performance.now() - start).toBeLessThan(250);
});
