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

// On: automatic WebP and per-device sizing, plus the Dynamic Image API for srcset loaders. Minification stays off because every framework already minifies.
const ENABLED_SETTINGS = {
  OptimizerEnabled: true,
  OptimizerAutomaticOptimizationEnabled: true,
  OptimizerEnableWebP: true,
  OptimizerEnableManipulationEngine: true,
  OptimizerMinifyCSS: false,
  OptimizerMinifyJavaScript: false,
  IgnoreQueryStrings: false,
  QueryStringVaryParameters: OPTIMIZER_QUERY_PARAMETERS,
} satisfies PullZoneSettings;

// Off: back to a site's default cache key, which ignores query strings.
const DISABLED_SETTINGS = {
  OptimizerEnabled: false,
  IgnoreQueryStrings: true,
  QueryStringVaryParameters: [],
} satisfies PullZoneSettings;

export const OptimizerStatusSchema = z.object({
  pullZone: z.number(),
  enabled: z.boolean(),
  webp: z.boolean(),
  dynamicImages: z.boolean(),
  minify: z.object({ css: z.boolean(), js: z.boolean() }),
  /** Query parameters in the cache key; empty when query strings are ignored, null when every parameter varies it. */
  cacheKeyParameters: z.array(z.string()).nullable(),
  /** True when every setting matches what `enabled` implies. */
  configured: z.boolean(),
  monthlyPrice: z.number(),
});
export type OptimizerStatus = z.infer<typeof OptimizerStatusSchema>;

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a.map((p) => p.toLowerCase()));
  return a.length === b.length && b.every((p) => set.has(p.toLowerCase()));
}

type OptimizerSettings = typeof ENABLED_SETTINGS | typeof DISABLED_SETTINGS;

function matches(zone: PullZoneModel, desired: OptimizerSettings): boolean {
  return Object.entries(desired).every(([key, want]) => {
    const have = zone[key as keyof PullZoneModel];
    if (Array.isArray(want)) {
      return sameMembers((have as string[] | null | undefined) ?? [], want);
    }
    return (have ?? false) === want;
  });
}

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
    configured: matches(zone, enabled ? ENABLED_SETTINGS : DISABLED_SETTINGS),
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
    "Turn Bunny Optimizer on (automatic WebP and per-device sizing, the Dynamic Image API, image parameters in the cache key, minification off) or off for a pull zone, then purge the cache so no unoptimized files are served. Optimizer is billed monthly per pull zone. Settings already in place are left alone.",
  schema: z.strictObject({
    pullZone: pullZoneRef,
    enabled: z.boolean().describe("`true` turns Optimizer on, `false` off."),
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
  run: async (ctx, { pullZone, enabled, purge }): Promise<OptimizerUpdate> => {
    const client = ctx.clients.core;
    ctx.progress("Fetching Optimizer status...");
    const zone = await fetchZone(client, pullZone, ctx.signal);
    const desired: OptimizerSettings = enabled
      ? ENABLED_SETTINGS
      : DISABLED_SETTINGS;
    if (matches(zone, desired)) {
      return { ...toOptimizerStatus(zone), changed: false, purged: false };
    }

    ctx.progress(
      enabled
        ? "Turning on Bunny Optimizer..."
        : "Turning off Bunny Optimizer...",
    );
    await client.POST("/pullzone/{id}", {
      params: { path: { id: pullZone } },
      body: desired,
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
