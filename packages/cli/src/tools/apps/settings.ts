import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/magic-containers";
import { z } from "zod";
import type { McClient } from "@/tools/context.ts";
import { defineTool } from "@/tools/define-tool.ts";
import { fetchApp } from "./app.ts";

type AutoscalingSettings = components["schemas"]["AutoscalingSettings"];
type RegionSettings = Pick<
  components["schemas"]["UpdateRegionSettingsRequest"],
  "allowedRegionIds" | "requiredRegionIds"
>;

const appRef = z.string().min(1).describe("App ID.");
const instances = z.number().int().min(1).max(1000);
const allowSplitVolumes = z
  .boolean()
  .optional()
  .describe("Allow a volume to be split across regions or instances.");

type App = components["schemas"]["Application"];

const ScalingSchema = z.object({ min: z.number(), max: z.number() });
const RegionSettingsSchema = z.object({
  allowedRegionIds: z.array(z.string()),
  requiredRegionIds: z.array(z.string()),
});

/** Refusal to split an app's volumes; commands reword the hint for their own flag. */
export class SplitVolumeError extends UserError {
  constructor(message: string) {
    super(
      message,
      "Volumes aren't shared: each region and each instance gets its own empty volume. Set `allowSplitVolumes` if each copy should keep separate data.",
    );
    this.name = "SplitVolumeError";
  }
}

// Volumes aren't shared, so more than one copy of an app with a mounted volume means separate, empty data per copy.
function assertNoSplit(app: App, reason: string | undefined, allow?: boolean) {
  const mounted = app.containerTemplates.some(
    (ct) => ct.volumeMounts.length > 0,
  );
  if (allow || !reason || !mounted) return;
  throw new SplitVolumeError(
    `App ${app.name} has a volume, but it would ${reason}.`,
  );
}

async function requireApp(client: McClient, appId: string): Promise<App> {
  const app = await fetchApp(client, appId);
  if (!app) throw new UserError(`App ${appId} not found.`);
  return app;
}

export const appsScale = defineTool({
  name: "apps.scale",
  title: "Scale an app",
  description:
    "Set the minimum and maximum instances for a Magic Containers app. A bound left out keeps its current value.",
  schema: z.strictObject({
    app: appRef,
    min: instances.optional().describe("Minimum instances."),
    max: instances.optional().describe("Maximum instances."),
    allowSplitVolumes,
  }),
  kind: "write",
  resultSchema: ScalingSchema,
  examples: [[{ app: "abc123", min: 1, max: 3 }, "Run 1 to 3 instances"]],
  run: async (ctx, input): Promise<AutoscalingSettings> => {
    if (input.min === undefined && input.max === undefined) {
      throw new UserError("Pass a minimum, a maximum, or both.");
    }

    ctx.progress("Fetching app...");
    const app = await requireApp(ctx.clients.mc, input.app);

    const scaling = {
      min: input.min ?? app.autoScaling?.min ?? 1,
      max: input.max ?? app.autoScaling?.max ?? 1,
    };
    if (scaling.min > scaling.max) {
      throw new UserError(
        `Minimum (${scaling.min}) can't be above maximum (${scaling.max}).`,
      );
    }
    assertNoSplit(
      app,
      scaling.max > 1 ? `scale to ${scaling.max} instances` : undefined,
      input.allowSplitVolumes,
    );

    ctx.progress("Updating scaling...");
    await ctx.clients.mc.PUT("/apps/{appId}/autoscaling", {
      params: { path: { appId: input.app } },
      body: scaling,
      signal: ctx.signal,
    });

    return scaling;
  },
});

export const appsRegionsSet = defineTool({
  name: "apps.regions.set",
  title: "Set app regions",
  description:
    "Set the regions a Magic Containers app may run in, and the ones it must always run in. Required regions default to all of the allowed ones.",
  schema: z.strictObject({
    app: appRef,
    regions: z
      .array(z.string().min(1))
      .min(1)
      .describe("Allowed region IDs, e.g. `DE`, `UK`."),
    required: z
      .array(z.string().min(1))
      .optional()
      .describe("Region IDs that must always run; defaults to `regions`."),
    allowSplitVolumes,
  }),
  kind: "write",
  resultSchema: RegionSettingsSchema,
  examples: [
    [{ app: "abc123", regions: ["DE", "UK"] }, "Run in DE and UK"],
    [
      { app: "abc123", regions: ["DE", "UK", "NY"], required: ["DE"] },
      "Allow three regions, always run in DE",
    ],
  ],
  run: async (ctx, input): Promise<RegionSettings> => {
    const allowed = input.regions.map((id) => id.toUpperCase());
    const required = (input.required ?? allowed).map((id) => id.toUpperCase());
    const outside = required.filter((id) => !allowed.includes(id));
    if (outside.length > 0) {
      throw new UserError(
        `Required regions must also be allowed: ${outside.join(", ")}.`,
      );
    }

    ctx.progress("Fetching app...");
    const app = await requireApp(ctx.clients.mc, input.app);
    const added = allowed.filter(
      (id) => !app.regionSettings.allowedRegionIds.includes(id),
    );
    assertNoSplit(
      app,
      allowed.length > 1
        ? `run in ${allowed.length} regions`
        : added.length > 0
          ? `move to ${added.join(", ")}, away from its existing volume data`
          : undefined,
      input.allowSplitVolumes,
    );

    ctx.progress("Updating regions...");
    await ctx.clients.mc.PUT("/apps/{appId}/region-settings", {
      params: { path: { appId: input.app } },
      body: {
        maxAllowedRegions: app.regionSettings.maxAllowedRegions,
        allowedRegionIds: allowed,
        requiredRegionIds: required,
      },
      signal: ctx.signal,
    });

    return { allowedRegionIds: allowed, requiredRegionIds: required };
  },
});
