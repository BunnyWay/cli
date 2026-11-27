import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import promptsLib from "prompts";
import { logger } from "@/core/logger.ts";
import { createToolContext, type McClient } from "@/tools/context.ts";
import { endedNormally, resolveApp, resolveTarget } from "./exec.ts";

// The repo itself is linked to an app, so app resolution runs from an empty directory.
const originalCwd = process.cwd();
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "apps-exec-"));
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

function appsStub(items: unknown[]) {
  let fetched = 0;
  const mc = {
    GET: () => {
      fetched++;
      return Promise.resolve({ data: { items, cursor: null } });
    },
  } as unknown as McClient;
  return {
    ctx: createToolContext({ clients: { mc } }),
    fetched: () => fetched,
  };
}

const APPS = [
  { id: "app-z", name: "zeta", status: "active" },
  { id: "app-a", name: "alpha", status: "active" },
];

test("--id wins without an API call", async () => {
  const { ctx, fetched } = appsStub(APPS);
  expect(await resolveApp(ctx, "app-x", true)).toBe("app-x");
  expect(fetched()).toBe(0);
});

test("uses the linked app without an API call", async () => {
  mkdirSync(join(dir, ".bunny"));
  writeFileSync(
    join(dir, ".bunny", "app.json"),
    JSON.stringify({ id: "app-linked" }),
  );
  const { ctx, fetched } = appsStub(APPS);
  expect(await resolveApp(ctx, undefined, true)).toBe("app-linked");
  expect(fetched()).toBe(0);
});

test("prompts for an app when none is linked", async () => {
  const { ctx } = appsStub(APPS);
  promptsLib.inject(["app-z"]);
  expect(await resolveApp(ctx, undefined, true)).toBe("app-z");
});

test("asks for --id instead of prompting when it can't prompt", async () => {
  const { ctx, fetched } = appsStub(APPS);
  await expect(resolveApp(ctx, undefined, false)).rejects.toThrow(
    "No linked app.",
  );
  expect(fetched()).toBe(0);
});

test("fails when the account has no apps", async () => {
  const { ctx } = appsStub([]);
  await expect(resolveApp(ctx, undefined, true)).rejects.toThrow(
    "No apps found on this account.",
  );
});

test("a cancelled app prompt stops the command", async () => {
  const { ctx } = appsStub(APPS);
  promptsLib.inject([new Error("cancelled")]);
  await expect(resolveApp(ctx, undefined, true)).rejects.toThrow(
    "An app is required.",
  );
});

function mcWith(regions: unknown[]) {
  let fetched = 0;
  const mc = {
    GET: () => {
      fetched++;
      return Promise.resolve({ data: { regions } });
    },
  } as unknown as McClient;
  return { mc: createToolContext({ clients: { mc } }), fetched: () => fetched };
}

const TWO_PODS = [
  {
    region: "DE",
    pods: [
      {
        name: "pod-a",
        status: "ready",
        containers: [
          { id: "ct-api", name: "api" },
          { id: "ct-worker", name: "worker" },
        ],
      },
      {
        name: "pod-b",
        status: "ready",
        containers: [{ id: "ct-api", name: "api" }],
      },
    ],
  },
];

test("passes both flags through without an API call", async () => {
  const { mc, fetched } = mcWith(TWO_PODS);
  expect(
    await resolveTarget(mc, "app1", { pod: "pod-a", container: "api" }, true),
  ).toEqual({ pod: "pod-a", container: "api" });
  expect(fetched()).toBe(0);
});

test("warns when the only pod isn't ready yet", async () => {
  const { mc } = mcWith([
    {
      region: "DE",
      pods: [
        {
          name: "pod-new",
          status: "scheduled",
          containers: [{ id: "ct-api", name: "api" }],
        },
      ],
    },
  ]);
  const warn = spyOn(logger, "warn").mockImplementation(() => {});
  try {
    expect(await resolveTarget(mc, "app1", {}, false)).toEqual({
      pod: "pod-new",
      container: "ct-api",
    });
    expect(warn).toHaveBeenCalledWith(
      "Pod pod-new is scheduled, not ready yet.",
    );
  } finally {
    warn.mockRestore();
  }
});

test("prompts for the pod, then the container", async () => {
  const { mc } = mcWith(TWO_PODS);
  promptsLib.inject(["pod-a", "ct-worker"]);
  expect(await resolveTarget(mc, "app1", {}, true)).toEqual({
    pod: "pod-a",
    container: "ct-worker",
  });
});

test("takes the only container without prompting", async () => {
  const { mc } = mcWith(TWO_PODS);
  promptsLib.inject(["pod-b"]);
  expect(await resolveTarget(mc, "app1", {}, true)).toEqual({
    pod: "pod-b",
    container: "ct-api",
  });
});

test("prompts only for the container when the pod is given", async () => {
  const { mc } = mcWith(TWO_PODS);
  promptsLib.inject(["ct-api"]);
  expect(await resolveTarget(mc, "app1", { pod: "pod-a" }, true)).toEqual({
    pod: "pod-a",
    container: "ct-api",
  });
});

test("resolves a container name to its ID", async () => {
  const { mc } = mcWith(TWO_PODS);
  promptsLib.inject(["pod-a"]);
  expect(
    await resolveTarget(mc, "app1", { container: "worker" }, true),
  ).toEqual({
    pod: "pod-a",
    container: "ct-worker",
  });
});

test("fails when the app has no pods", async () => {
  const { mc } = mcWith([{ region: "DE", pods: [] }]);
  await expect(resolveTarget(mc, "app1", {}, true)).rejects.toThrow(
    "App app1 has no running instances.",
  );
});

test("a cancelled pod prompt stops the command", async () => {
  const { mc } = mcWith(TWO_PODS);
  promptsLib.inject([new Error("cancelled")]);
  await expect(resolveTarget(mc, "app1", {}, true)).rejects.toThrow(
    "A pod is required.",
  );
});

test("asks for --pod instead of prompting when it can't prompt", async () => {
  const { mc } = mcWith(TWO_PODS);
  const error = await resolveTarget(mc, "app1", {}, false).catch((e) => e);
  expect(error.message).toBe(
    "Pass --pod: there's more than one to choose from.",
  );
  expect(error.hint).toBe("Choose one of: pod-a, pod-b.");
});

test("asks for --container instead of prompting when it can't prompt", async () => {
  const { mc } = mcWith(TWO_PODS);
  await expect(
    resolveTarget(mc, "app1", { pod: "pod-a" }, false),
  ).rejects.toThrow("Pass --container: there's more than one to choose from.");
});

test("still takes the only choices when it can't prompt", async () => {
  const { mc } = mcWith(TWO_PODS);
  expect(await resolveTarget(mc, "app1", { pod: "pod-b" }, false)).toEqual({
    pod: "pod-b",
    container: "ct-api",
  });
});

test("a shell exit counts as a normal end, an error close does not", () => {
  // 1006 is how a session can end when the remote shell exits.
  expect([1000, 1005, 1006].every(endedNormally)).toBe(true);
  expect([1008, 1011, 4000].some(endedNormally)).toBe(false);
});
