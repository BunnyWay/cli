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

test("pullzones.optimizer.set turns Optimizer on, keys the cache on image parameters only, and purges", async () => {
  const { ctx, calls } = fakeCore({
    OptimizerEnabled: false,
    IgnoreQueryStrings: true,
    OptimizerMinifyCSS: true,
  });
  const result = await pullZonesOptimizerSet.invoke(ctx, {
    pullZone: 7,
    enabled: true,
  });
  expect(calls.map((c) => c.path)).toEqual([
    "/pullzone/{id}",
    "/pullzone/{id}/purgeCache",
  ]);
  expect(calls[0]?.body).toMatchObject({
    OptimizerEnabled: true,
    OptimizerEnableWebP: true,
    OptimizerEnableManipulationEngine: true,
    OptimizerMinifyCSS: false,
    OptimizerMinifyJavaScript: false,
    IgnoreQueryStrings: false,
    QueryStringVaryParameters: OPTIMIZER_QUERY_PARAMETERS,
  });
  expect(result).toMatchObject({
    enabled: true,
    configured: true,
    changed: true,
    purged: true,
  });
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

test("pullzones.optimizer.set re-applies drifted settings when Optimizer is already on", async () => {
  const { ctx, calls } = fakeCore({
    ...ENABLED_ZONE,
    OptimizerMinifyCSS: true,
  });
  await pullZonesOptimizerSet.invoke(ctx, {
    pullZone: 7,
    enabled: true,
    purge: false,
  });
  expect(calls.map((c) => c.path)).toEqual(["/pullzone/{id}"]);
});

test("pullzones.optimizer.set off restores a cache key that ignores query strings", async () => {
  const { ctx, calls } = fakeCore({ ...ENABLED_ZONE });
  const result = await pullZonesOptimizerSet.invoke(ctx, {
    pullZone: 7,
    enabled: false,
  });
  expect(calls[0]?.body).toEqual({
    OptimizerEnabled: false,
    IgnoreQueryStrings: true,
    QueryStringVaryParameters: [],
  });
  expect(result).toMatchObject({
    enabled: false,
    configured: true,
    cacheKeyParameters: [],
  });
});

test("pullzones.optimizer.get falls back to the list price", async () => {
  const { ctx } = fakeCore({ OptimizerEnabled: false, OptimizerPricing: 0 });
  const status = await pullZonesOptimizerGet.invoke(ctx, { pullZone: 7 });
  expect(status).toMatchObject({ enabled: false, monthlyPrice: 9.5 });
});
