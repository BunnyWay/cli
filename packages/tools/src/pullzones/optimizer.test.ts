import { expect, test } from "bun:test";
import { type CoreClient, createToolContext } from "../context.ts";
import {
  OPTIMIZER_QUERY_PARAMETERS,
  pullZonesOptimizerGet,
  pullZonesOptimizerSet,
} from "./optimizer.ts";

function fakeCore(zone: Record<string, unknown>) {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const core = {
    GET: () => Promise.resolve({ data: { Id: 7, ...zone } }),
    POST: (path: string, opts: { body?: Record<string, unknown> }) => {
      calls.push({ path, body: opts.body });
      if (path === "/pullzone/{id}") Object.assign(zone, opts.body);
      return Promise.resolve({ data: {} });
    },
  } as unknown as CoreClient;
  return { ctx: createToolContext({ clients: { core } }), calls };
}

const ENABLED_ZONE = {
  OptimizerEnabled: true,
  OptimizerAutomaticOptimizationEnabled: true,
  OptimizerEnableWebP: true,
  OptimizerEnableManipulationEngine: true,
  OptimizerMinifyCSS: false,
  OptimizerMinifyJavaScript: false,
  IgnoreQueryStrings: false,
  QueryStringVaryParameters: [...OPTIMIZER_QUERY_PARAMETERS].reverse(),
  OptimizerPricing: 9.5,
};

test("pullzones.optimizer.set turns Optimizer on, adds image parameters to a key that ignored query strings, and purges", async () => {
  const { ctx, calls } = fakeCore({
    OptimizerEnabled: false,
    IgnoreQueryStrings: true,
    OptimizerMinifyCSS: true,
  });
  const result = await pullZonesOptimizerSet.invoke(ctx, {
    pullZone: 7,
    enabled: true,
    minify: false,
  });
  expect(calls.map((c) => c.path)).toEqual([
    "/pullzone/{id}",
    "/pullzone/{id}/purgeCache",
  ]);
  expect(calls[0]?.body).toMatchObject({
    OptimizerEnabled: true,
    OptimizerMinifyCSS: false,
    IgnoreQueryStrings: false,
    QueryStringVaryParameters: OPTIMIZER_QUERY_PARAMETERS,
  });
  expect(result).toMatchObject({
    configured: true,
    changed: true,
    purged: true,
  });
});

test("pullzones.optimizer.set never narrows an existing cache key or touches minification unasked", async () => {
  const custom = fakeCore({
    IgnoreQueryStrings: false,
    QueryStringVaryParameters: ["page"],
    OptimizerMinifyCSS: true,
  });
  await pullZonesOptimizerSet.invoke(custom.ctx, {
    pullZone: 7,
    enabled: true,
  });
  expect(custom.calls[0]?.body).toMatchObject({
    QueryStringVaryParameters: ["page", ...OPTIMIZER_QUERY_PARAMETERS],
  });
  expect(custom.calls[0]?.body).not.toHaveProperty("OptimizerMinifyCSS");

  const everyParameter = fakeCore({
    IgnoreQueryStrings: false,
    QueryStringVaryParameters: [],
  });
  await pullZonesOptimizerSet.invoke(everyParameter.ctx, {
    pullZone: 7,
    enabled: true,
  });
  expect(everyParameter.calls[0]?.body).not.toHaveProperty(
    "QueryStringVaryParameters",
  );
});

test("pullzones.optimizer.set leaves a zone that already matches alone", async () => {
  const { ctx, calls } = fakeCore({ ...ENABLED_ZONE });
  const result = await pullZonesOptimizerSet.invoke(ctx, {
    pullZone: 7,
    enabled: true,
  });
  expect(calls).toEqual([]);
  expect(result).toMatchObject({ changed: false, purged: false });
});

test("pullzones.optimizer.set off undoes only the cache key it added", async () => {
  const added = fakeCore({ ...ENABLED_ZONE });
  await pullZonesOptimizerSet.invoke(added.ctx, {
    pullZone: 7,
    enabled: false,
  });
  expect(added.calls[0]?.body).toEqual({
    OptimizerEnabled: false,
    IgnoreQueryStrings: true,
    QueryStringVaryParameters: [],
  });

  const custom = fakeCore({
    ...ENABLED_ZONE,
    QueryStringVaryParameters: ["page", ...OPTIMIZER_QUERY_PARAMETERS],
  });
  await pullZonesOptimizerSet.invoke(custom.ctx, {
    pullZone: 7,
    enabled: false,
  });
  expect(custom.calls[0]?.body).toEqual({ OptimizerEnabled: false });
});

test("pullzones.optimizer.get falls back to the list price", async () => {
  const { ctx } = fakeCore({ OptimizerEnabled: false, OptimizerPricing: 0 });
  const status = await pullZonesOptimizerGet.invoke(ctx, { pullZone: 7 });
  expect(status).toMatchObject({ enabled: false, monthlyPrice: 9.5 });
});
