import { expect, test } from "bun:test";
import promptsLib from "prompts";
import { createToolContext, type McClient } from "@/tools/context.ts";
import { resolveTarget } from "./exec.ts";

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
