import { expect, test } from "bun:test";
import { ApiError, createMcClient } from "@bunny.net/openapi-client";
import { createToolContext, type McClient } from "@/tools/context.ts";
import { appsExec, appsPodsList, fetchPods } from "./exec.ts";

const OVERVIEW = {
  regions: [
    {
      region: "DE",
      pods: [
        {
          name: "app-de-1",
          status: "ready",
          containers: [
            { id: "ct-api", name: "api", status: "ready" },
            { id: "ct-worker", name: "worker", status: "ready" },
          ],
        },
      ],
    },
    {
      region: "UK",
      pods: [
        {
          name: "app-uk-1",
          status: "scheduled",
          containers: [{ id: "ct-api", name: "api", status: "started" }],
        },
      ],
    },
  ],
};

function mcStub(post: (body: unknown) => Promise<unknown>) {
  const calls: Array<{ path: string; body: unknown }> = [];
  const mc = {
    GET: (path: string) => {
      expect(path).toBe("/apps/{appId}/overview");
      return Promise.resolve({ data: OVERVIEW });
    },
    POST: (path: string, init: { body: unknown }) => {
      calls.push({ path, body: init.body });
      return post(init.body);
    },
  } as unknown as McClient;
  return { mc, calls };
}

test("fetchPods flattens pods out of their regions", async () => {
  const { mc } = mcStub(() => Promise.resolve({}));
  const pods = await fetchPods(mc, "app1");
  expect(pods.map((p) => [p.name, p.region, p.containers.length])).toEqual([
    ["app-de-1", "DE", 2],
    ["app-uk-1", "UK", 1],
  ]);
});

test("apps.exec sends the pod name and the container's ID", async () => {
  const { mc, calls } = mcStub(() =>
    Promise.resolve({ data: { url: "wss://exec.example/s/abc" } }),
  );
  const ctx = createToolContext({ clients: { mc } });

  const session = await appsExec.invoke(ctx, {
    app: "app1",
    pod: "app-de-1",
    container: "worker",
  });

  expect(calls).toEqual([
    {
      path: "/apps/{appId}/exec",
      body: { podName: "app-de-1", containerName: "ct-worker" },
    },
  ]);
  expect(session).toEqual({
    app: "app1",
    pod: "app-de-1",
    container: { id: "ct-worker", name: "worker" },
    url: "wss://exec.example/s/abc",
  });
});

test("apps.exec accepts a container ID", async () => {
  const { mc, calls } = mcStub(() =>
    Promise.resolve({ data: { url: "wss://x" } }),
  );
  const ctx = createToolContext({ clients: { mc } });
  await appsExec.invoke(ctx, {
    app: "a",
    pod: "app-uk-1",
    container: "ct-api",
  });
  expect(calls[0]?.body).toEqual({
    podName: "app-uk-1",
    containerName: "ct-api",
  });
});

test("apps.exec names the existing pods when the pod is unknown", async () => {
  const { mc, calls } = mcStub(() => Promise.resolve({}));
  const ctx = createToolContext({ clients: { mc } });
  const error = await appsExec
    .invoke(ctx, { app: "app1", pod: "nope", container: "api" })
    .catch((e) => e);
  expect(error.message).toBe("Pod nope not found in app app1.");
  expect(error.hint).toBe("Running pods: app-de-1, app-uk-1.");
  expect(calls).toHaveLength(0);
});

test("apps.exec names the pod's containers when the container is unknown", async () => {
  const { mc } = mcStub(() => Promise.resolve({}));
  const ctx = createToolContext({ clients: { mc } });
  const error = await appsExec
    .invoke(ctx, { app: "app1", pod: "app-de-1", container: "db" })
    .catch((e) => e);
  expect(error.message).toBe("Container db not found in pod app-de-1.");
  expect(error.hint).toBe("Containers: api, worker.");
});

test("apps.exec explains a 403 as exec not being enabled", async () => {
  const { mc } = mcStub(() => Promise.reject(new ApiError("Forbidden", 403)));
  const ctx = createToolContext({ clients: { mc } });
  await expect(
    appsExec.invoke(ctx, { app: "a", pod: "app-de-1", container: "api" }),
  ).rejects.toThrow("Exec isn't available for this account.");
});

test("apps.exec fails when the API returns no URL", async () => {
  const { mc } = mcStub(() => Promise.resolve({ data: {} }));
  const ctx = createToolContext({ clients: { mc } });
  await expect(
    appsExec.invoke(ctx, { app: "a", pod: "app-de-1", container: "api" }),
  ).rejects.toThrow("The API did not return an exec session.");
});

test("apps.pods.list returns the app's pods", async () => {
  const { mc } = mcStub(() => Promise.resolve({}));
  const ctx = createToolContext({ clients: { mc } });
  const pods = await appsPodsList.invoke(ctx, { app: "app1" });
  expect(pods.map((p) => p.name)).toEqual(["app-de-1", "app-uk-1"]);
});

test("apps.exec reads a bare 404 as a missing exec endpoint", async () => {
  // An empty 404 body leaves ApiError with its generic message.
  const { mc } = mcStub(() => Promise.reject(new ApiError("Not found.", 404)));
  const ctx = createToolContext({ clients: { mc } });
  await expect(
    appsExec.invoke(ctx, { app: "a", pod: "app-de-1", container: "api" }),
  ).rejects.toThrow("This API has no exec endpoint.");
});

test("apps.exec passes on the API's explanation of a 404", async () => {
  const { mc } = mcStub(() =>
    Promise.reject(new ApiError("Pod app-de-1 not found.", 404)),
  );
  const ctx = createToolContext({ clients: { mc } });
  await expect(
    appsExec.invoke(ctx, { app: "a", pod: "app-de-1", container: "api" }),
  ).rejects.toThrow(
    "Couldn't open a session in api on pod app-de-1: Pod app-de-1 not found.",
  );
});

// Runs through the real middleware: the bare-404 check keys off its fallback wording, so this fails if that wording drifts.
test("apps.exec reads a real empty 404 as a missing exec endpoint", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      req.method === "GET"
        ? Response.json(OVERVIEW)
        : new Response(null, { status: 404 }),
  });
  try {
    const mc = createMcClient({
      apiKey: "test",
      baseUrl: `http://localhost:${server.port}`,
    });
    const ctx = createToolContext({ clients: { mc } });
    await expect(
      appsExec.invoke(ctx, { app: "a", pod: "app-de-1", container: "api" }),
    ).rejects.toThrow("This API has no exec endpoint.");
  } finally {
    server.stop(true);
  }
});
