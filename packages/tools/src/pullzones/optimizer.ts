import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/core";
import { z } from "zod";
import type { CoreClient } from "../context.ts";
import { defineTool } from "../define-tool.ts";

type PullZoneModel = components["schemas"]["PullZoneModel"];
type PullZoneSettings = components["schemas"]["PullZoneSettingsModel"];

/** List price per pull zone, used when the API doesn't report one. */
export const OPTIMIZER_MONTHLY_PRICE = 9.5;

// The Dynamic Image API's query parameters. Only these vary the cache, so junk like `utm_source` doesn't split it.
export const OPTIMIZER_QUERY_PARAMETERS = [
  "width",
  "height",
  "aspect_ratio",
  "quality",
  "sharpen",
  "blur",
  "crop",
  "crop_gravity",
  "flip",
  "flop",
  "brightness",
  "saturation",
  "hue",
  "contrast",
  "sepia",
  "auto_optimize",
  "output",
];

// Optimizer's own switches; the zone's cache key and minification are handled separately so other settings survive.
const OPTIMIZER_FLAGS = {
  OptimizerEnabled: true,
  OptimizerAutomaticOptimizationEnabled: true,
  OptimizerEnableWebP: true,
  OptimizerEnableManipulationEngine: true,
} satisfies PullZoneSettings;

const sameParameter = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

function hasAll(have: readonly string[], want: readonly string[]): boolean {
  return want.every((w) => have.some((h) => sameParameter(h, w)));
}

/** The Dynamic Image API needs its parameters in the cache key; add them without changing how any other parameter is cached. */
function imageCacheKey(zone: PullZoneModel): PullZoneSettings {
  const vary = zone.QueryStringVaryParameters ?? [];
  // Every parameter already varies the cache.
  if (!zone.IgnoreQueryStrings && vary.length === 0) return {};
  const base = zone.IgnoreQueryStrings ? [] : vary;
  const missing = OPTIMIZER_QUERY_PARAMETERS.filter(
    (p) => !base.some((b) => sameParameter(b, p)),
  );
  return {
    IgnoreQueryStrings: false,
    QueryStringVaryParameters: [...base, ...missing],
  };
}

/** Undo {@link imageCacheKey} only when the key is exactly what it adds to a zone that ignored query strings. */
function restoredCacheKey(zone: PullZoneModel): PullZoneSettings {
  const vary = zone.QueryStringVaryParameters ?? [];
  const onlyImageParameters =
    !zone.IgnoreQueryStrings &&
    vary.length === OPTIMIZER_QUERY_PARAMETERS.length &&
    hasAll(vary, OPTIMIZER_QUERY_PARAMETERS);
  return onlyImageParameters
    ? { IgnoreQueryStrings: true, QueryStringVaryParameters: [] }
    : {};
}

function desiredSettings(
  zone: PullZoneModel,
  enabled: boolean,
  minify: boolean | undefined,
): PullZoneSettings {
  const minification =
    minify === undefined
      ? {}
      : { OptimizerMinifyCSS: minify, OptimizerMinifyJavaScript: minify };
  return enabled
    ? { ...OPTIMIZER_FLAGS, ...imageCacheKey(zone), ...minification }
    : { OptimizerEnabled: false, ...restoredCacheKey(zone) };
}

/** The subset of `desired` that differs from the zone. */
function changes(
  zone: PullZoneModel,
  desired: PullZoneSettings,
): PullZoneSettings {
  return Object.fromEntries(
    Object.entries(desired).filter(([key, want]) => {
      const have = zone[key as keyof PullZoneModel];
      if (Array.isArray(want)) {
        const list = (have as string[] | null | undefined) ?? [];
        return !(list.length === want.length && hasAll(list, want as string[]));
      }
      return (have ?? false) !== want;
    }),
  );
}

export const OptimizerStatusSchema = z.object({
  pullZone: z.number(),
  enabled: z.boolean(),
  webp: z.boolean(),
  dynamicImages: z.boolean(),
  minify: z.object({ css: z.boolean(), js: z.boolean() }),
  /** Query parameters in the cache key; empty when query strings are ignored, null when every parameter varies it. */
  cacheKeyParameters: z.array(z.string()).nullable(),
  /** True when Optimizer's settings, and a cache key that admits image parameters, match what `enabled` implies. */
  configured: z.boolean(),
  monthlyPrice: z.number(),
});
export type OptimizerStatus = z.infer<typeof OptimizerStatusSchema>;

export function toOptimizerStatus(zone: PullZoneModel): OptimizerStatus {
  const enabled = zone.OptimizerEnabled ?? false;
  const vary = zone.QueryStringVaryParameters ?? [];
  return {
    pullZone: zone.Id ?? 0,
    enabled,
    webp: zone.OptimizerEnableWebP ?? false,
    dynamicImages: zone.OptimizerEnableManipulationEngine ?? false,
    minify: {
      css: zone.OptimizerMinifyCSS ?? false,
      js: zone.OptimizerMinifyJavaScript ?? false,
    },
    cacheKeyParameters: zone.IgnoreQueryStrings
      ? []
      : vary.length
        ? vary
        : null,
    configured:
      Object.keys(changes(zone, desiredSettings(zone, enabled, undefined)))
        .length === 0,
    monthlyPrice: zone.OptimizerPricing || OPTIMIZER_MONTHLY_PRICE,
  };
}

async function fetchZone(
  client: CoreClient,
  id: number,
  signal?: AbortSignal,
): Promise<PullZoneModel> {
  const { data } = await client.GET("/pullzone/{id}", {
    params: { path: { id } },
    signal,
  });
  if (!data) throw new UserError(`Pull zone ${id} not found.`);
  return data;
}

const pullZoneRef = z
  .number()
  .int()
  .positive()
  .describe("Pull zone ID, e.g. `12345`.");

export const pullZonesOptimizerGet = defineTool({
  name: "pullzones.optimizer.get",
  title: "Get Bunny Optimizer status",
  description:
    "Show whether Bunny Optimizer is on for a pull zone, the settings it runs with, and its monthly price.",
  schema: z.strictObject({ pullZone: pullZoneRef }),
  kind: "read",
  resultSchema: OptimizerStatusSchema,
  examples: [[{ pullZone: 12345 }, "Show Optimizer status"]],
  run: async (ctx, { pullZone }): Promise<OptimizerStatus> => {
    ctx.progress("Fetching Optimizer status...");
    return toOptimizerStatus(
      await fetchZone(ctx.clients.core, pullZone, ctx.signal),
    );
  },
});

export const OptimizerUpdateSchema = OptimizerStatusSchema.extend({
  changed: z.boolean(),
  purged: z.boolean(),
});
export type OptimizerUpdate = z.infer<typeof OptimizerUpdateSchema>;

export const pullZonesOptimizerSet = defineTool({
  name: "pullzones.optimizer.set",
  title: "Turn Bunny Optimizer on or off",
  description:
    "Turn Bunny Optimizer on (automatic WebP and per-device sizing, the Dynamic Image API, image parameters added to the cache key) or off for a pull zone, then purge the cache so no unoptimized files are served. Other query parameters keep caching as before. Optimizer is billed monthly per pull zone. Settings already in place are left alone.",
  schema: z.strictObject({
    pullZone: pullZoneRef,
    enabled: z.boolean().describe("`true` turns Optimizer on, `false` off."),
    minify: z
      .boolean()
      .optional()
      .describe(
        "Set CSS and JavaScript minification when turning on; omit to leave it as is.",
      ),
    purge: z
      .boolean()
      .default(true)
      .describe("Purge the cache after a change (default: true)."),
  }),
  kind: "write",
  resultSchema: OptimizerUpdateSchema,
  examples: [
    [{ pullZone: 12345, enabled: true }, "Turn Optimizer on"],
    [{ pullZone: 12345, enabled: false }, "Turn Optimizer off"],
  ],
  run: async (
    ctx,
    { pullZone, enabled, minify, purge },
  ): Promise<OptimizerUpdate> => {
    const client = ctx.clients.core;
    ctx.progress("Fetching Optimizer status...");
    const zone = await fetchZone(client, pullZone, ctx.signal);
    const patch = changes(zone, desiredSettings(zone, enabled, minify));
    if (Object.keys(patch).length === 0) {
      return { ...toOptimizerStatus(zone), changed: false, purged: false };
    }

    ctx.progress(
      enabled
        ? "Turning on Bunny Optimizer..."
        : "Turning off Bunny Optimizer...",
    );
    await client.POST("/pullzone/{id}", {
      params: { path: { id: pullZone } },
      body: patch,
      signal: ctx.signal,
    });
    // Cached responses were built under the old settings, e.g. full-size PNGs.
    if (purge) {
      ctx.progress("Purging cache...");
      await client.POST("/pullzone/{id}/purgeCache", {
        params: { path: { id: pullZone } },
        signal: ctx.signal,
      });
    }
    const updated = await fetchZone(client, pullZone, ctx.signal);
    return { ...toOptimizerStatus(updated), changed: true, purged: purge };
  },
});
