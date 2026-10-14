import type { ToolContext } from "@bunny.net/tools";
import { type PullZone, pullZonesList } from "@bunny.net/tools/pullzones";
import { UserError } from "@/core/errors.ts";
import { loadManifest, saveManifest } from "@/core/manifest.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import { PULL_ZONE_MANIFEST, type PullZoneManifest } from "./constants.ts";

/** A pull zone a command acts on, named the way its owner (a site, a script, a bare zone) is known. */
export interface PullZoneTarget {
  pullZone: number;
  name: string;
  /** What `name` names, for output rows, e.g. "Site" or "Pull zone". */
  label: string;
}

/** A kind of directory link that leads to a pull zone; resources register one so pull-zone commands work from their directories. */
export interface PullZoneSource<T extends PullZoneTarget = PullZoneTarget> {
  /** Whether the current directory is linked to this kind of resource. */
  linked(): boolean;
  resolve(ctx: ToolContext, output: OutputFormat): Promise<T>;
}

const toTarget = (zone: PullZone): PullZoneTarget => ({
  pullZone: zone.id,
  name: zone.name,
  label: "Pull zone",
});

async function listZones(ctx: ToolContext): Promise<PullZone[]> {
  return withSpinner("Fetching pull zones...", () =>
    pullZonesList.invoke(ctx, {}),
  );
}

function findZone(zones: PullZone[], ref: string): PullZone {
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

/** `.bunny/pullzone.json`, written by `bunny pz link`. */
export const linkedPullZoneSource: PullZoneSource = {
  linked: () => !!loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST).id,
  resolve: async (ctx) => {
    const { id } = loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST);
    return toTarget(findZone(await listZones(ctx), String(id)));
  },
};

/** An explicit ID or name, then the first linked source, then a picker that offers to link the directory. */
export async function resolvePullZoneTarget<T extends PullZoneTarget>(
  ctx: ToolContext,
  ref: string | undefined,
  output: OutputFormat,
  sources: PullZoneSource<T>[],
): Promise<T | PullZoneTarget> {
  if (ref) return toTarget(findZone(await listZones(ctx), ref));

  const source = sources.find((s) => s.linked());
  if (source) return source.resolve(ctx, output);

  if (!isInteractive(output)) {
    throw new UserError(
      "No pull zone specified and none linked.",
      "Pass a pull zone ID or name, or run `bunny pz link`.",
    );
  }
  const zones = await listZones(ctx);
  if (zones.length === 0) {
    throw new UserError(
      "No pull zones found.",
      'Run "bunny pz create" to create one.',
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
  return toTarget(zone);
}
