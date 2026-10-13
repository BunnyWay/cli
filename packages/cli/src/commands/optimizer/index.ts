import type { ToolContext } from "@bunny.net/tools";
import { type PullZone, pullZonesList } from "@bunny.net/tools/pullzones";
import {
  PULL_ZONE_MANIFEST,
  type PullZoneManifest,
} from "@/commands/pz/constants.ts";
import { loadSiteConfig } from "@/commands/sites/config.ts";
import {
  SITES_MANIFEST,
  type SiteManifest,
} from "@/commands/sites/constants.ts";
import { syncOptimizerConfig } from "@/commands/sites/optimizer/shared.ts";
import {
  resolveSitePullZone,
  type SitePullZone,
} from "@/commands/sites/optimizer/site.ts";
import { UserError } from "@/core/errors.ts";
import { loadManifest, saveManifest } from "@/core/manifest.ts";
import { createOptimizerCommands } from "@/core/optimizer/index.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, prompts, withSpinner } from "@/core/ui.ts";

const target = (zone: PullZone): SitePullZone => ({
  name: zone.name,
  pullZone: zone.id,
  fromDirectory: false,
});

function find(zones: PullZone[], ref: string): PullZone {
  const zone = /^\d+$/.test(ref)
    ? zones.find((z) => z.id === Number(ref))
    : zones.find((z) => z.name === ref);
  if (!zone) {
    throw new UserError(
      `No pull zone found for "${ref}".`,
      "Pass a pull zone ID or name (see `bunny pz list`).",
    );
  }
  return zone;
}

/** Explicit ref, then the linked pull zone, then the linked site, then a picker that offers to link. */
export async function resolveOptimizerPullZone(
  ctx: ToolContext,
  ref: string | undefined,
  output: OutputFormat,
): Promise<SitePullZone> {
  const linked = ref ?? loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST).id;
  const siteLinked =
    loadManifest<SiteManifest>(SITES_MANIFEST).id ||
    loadSiteConfig()?.config.name;
  if (linked === undefined && siteLinked) {
    return resolveSitePullZone(ctx, { output });
  }

  const zones = await withSpinner("Fetching pull zones...", () =>
    pullZonesList.invoke(ctx, {}),
  );
  if (linked !== undefined) return target(find(zones, String(linked)));

  if (!isInteractive(output) || zones.length === 0) {
    throw new UserError(
      "No pull zone specified and none linked.",
      "Pass a pull zone ID or name, or run `bunny pz link`.",
    );
  }
  const { selected } = await prompts({
    type: "select",
    name: "selected",
    message: "Select a pull zone:",
    choices: zones.map((z) => ({ title: `${z.name} (${z.id})`, value: z })),
  });
  if (!selected) throw new UserError("A pull zone is required.");
  const zone = selected as PullZone;
  if (
    await confirm(`Link this directory to ${zone.name}?`, {
      initial: true,
      optional: true,
    })
  ) {
    saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, {
      id: zone.id,
      name: zone.name,
    });
  }
  return target(zone);
}

export const optimizerNamespace = createOptimizerCommands({
  commandPath: "optimizer",
  describe:
    "Serve images as WebP sized for each device on any pull zone (Bunny Optimizer).",
  positional: {
    name: "pull-zone",
    describe:
      "Pull zone ID or name (uses the linked pull zone or site if omitted)",
  },
  label: "Pull zone",
  resolve: (ref, args, ctx) => resolveOptimizerPullZone(ctx, ref, args.output),
  // A linked site keeps `sites.optimizer` in step, as `sites optimizer` does.
  onChanged: syncOptimizerConfig,
});
