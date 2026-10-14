import type { ToolContext } from "@bunny.net/tools";
import { type PullZone, pullZonesList } from "@bunny.net/tools/pullzones";
import { UserError } from "@/core/errors.ts";
import { loadManifest } from "@/core/manifest.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import { loadSiteConfig } from "../config.ts";
import {
  SITES_MANIFEST,
  type SiteManifest,
  siteResourcePattern,
} from "../constants.ts";

export interface SitePullZone {
  name: string;
  pullZone: number;
  /** Resolved from `.bunny/site.json` or `sites.name`, so bunny.jsonc describes this site. */
  fromDirectory: boolean;
}

// Created sites name their zones `sites-{name}-{suffix}`.
const CREATED_SITE_ZONE = /^sites-(.+)-[a-z0-9]{6}$/i;

function displayName(zone: PullZone): string {
  return CREATED_SITE_ZONE.exec(zone.name)?.[1] ?? zone.name;
}

function pick(
  zones: PullZone[],
  name: string | undefined,
): PullZone | undefined {
  if (zones.length <= 1) return zones[0];
  // An imported storage zone can have other pull zones in front of it; the site's own carries its name.
  const pattern = name ? siteResourcePattern(name) : CREATED_SITE_ZONE;
  const named = zones.filter((z) => pattern.test(z.name));
  return named.length === 1 ? named[0] : undefined;
}

function byStorageZone(
  zones: PullZone[],
  id: number,
  name?: string,
): PullZone | undefined {
  return pick(
    zones.filter((z) => z.storageZoneId === id),
    name,
  );
}

function byName(zones: PullZone[], name: string): PullZone | undefined {
  const pattern = siteResourcePattern(name);
  const created = zones.filter((z) => pattern.test(z.name));
  if (created.length > 1) {
    throw new UserError(
      `Multiple sites are named "${name}".`,
      "Pass the site's storage zone ID instead (see `bunny sites list`).",
    );
  }
  return created[0] ?? zones.find((z) => z.name === name);
}

/**
 * Resolve a site to its pull zone through the pull zone list, in the same order as every sites command: explicit ref, `.bunny/site.json`, `sites.name`, then a picker.
 *
 * Sites are storage-backed pull zones, so this needs no storage credentials; an imported site whose pull zone kept its own name resolves by its storage zone ID.
 */
export async function resolveSitePullZone(
  ctx: ToolContext,
  args: { site?: string; output: OutputFormat },
): Promise<SitePullZone> {
  const zones = await withSpinner("Resolving site...", async () =>
    (await pullZonesList.invoke(ctx, {})).filter(
      (z) => z.storageZoneId !== null,
    ),
  );
  const found = (
    zone: PullZone | undefined,
    label: string,
    fromDirectory = false,
  ): SitePullZone => {
    if (!zone) {
      throw new UserError(
        `No site found for "${label}".`,
        "Run `bunny sites list` to see your sites, and pass a site name or storage zone ID.",
      );
    }
    return { name: displayName(zone), pullZone: zone.id, fromDirectory };
  };

  const ref = args.site;
  if (ref) {
    const zone = /^\d+$/.test(ref)
      ? byStorageZone(zones, Number(ref))
      : byName(zones, ref);
    return found(zone, ref);
  }

  const manifest = loadManifest<SiteManifest>(SITES_MANIFEST);
  if (manifest.id) {
    return found(
      byStorageZone(zones, manifest.id, manifest.name),
      manifest.name ?? String(manifest.id),
      true,
    );
  }

  const configured = loadSiteConfig()?.config.name;
  if (configured) return found(byName(zones, configured), configured, true);

  const sites = zones.filter((z) => CREATED_SITE_ZONE.test(z.name));
  if (!isInteractive(args.output) || sites.length === 0) {
    throw new UserError(
      "No site specified and no linked site found.",
      "Pass a site name or run `bunny sites link`.",
    );
  }
  const { selected } = await prompts({
    type: "select",
    name: "selected",
    message: "Select a site:",
    choices: sites.map((z) => ({
      title: `${displayName(z)} (${z.storageZoneId})`,
      value: z,
    })),
  });
  if (!selected) throw new UserError("A site is required.");
  return found(selected as PullZone, "");
}
