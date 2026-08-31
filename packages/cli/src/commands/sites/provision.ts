import { basename } from "node:path";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { prompts, withSpinner } from "../../core/ui.ts";
import type { CoreClient } from "../storage/api.ts";
import {
  SSD_PRIMARY_REGION,
  type ZoneTierChoice,
} from "../storage/constants.ts";
import {
  type CreateSiteResult,
  createSite,
  type SiteContext,
  siteContextFromZone,
} from "./api.ts";
import {
  isValidSiteName,
  SITES_MANIFEST,
  type SiteManifest,
} from "./constants.ts";

export const SITE_NAME_RULES =
  "Use 3-47 lowercase letters, digits, and dashes (no leading/trailing dash).";

/** Best-effort site name from the current directory, or undefined if it can't be one. */
export function suggestSiteName(): string | undefined {
  const base = basename(process.cwd())
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return isValidSiteName(base) ? base : undefined;
}

// Resolve a site name: normalize a passed one, else prompt (defaulting to the directory name); throws with `missingHint` when none is available and we can't prompt.
export async function promptSiteName(
  nameArg: string | undefined,
  interactive: boolean,
  missingHint = "Pass one: bunny sites create <name>.",
): Promise<string> {
  let name = nameArg?.trim().toLowerCase();
  if (!name && interactive) {
    const suggestion = suggestSiteName();
    const { value } = await prompts({
      type: "text",
      name: "value",
      message: "Site name:",
      ...(suggestion ? { initial: suggestion } : {}),
      validate: (v: string) =>
        isValidSiteName(String(v).trim().toLowerCase()) || SITE_NAME_RULES,
    });
    name = (value as string | undefined)?.trim().toLowerCase();
  }
  if (!name) {
    throw new UserError("Site name is required.", missingHint);
  }
  if (!isValidSiteName(name)) {
    throw new UserError(
      `"${nameArg ?? name}" is not a valid site name.`,
      SITE_NAME_RULES,
    );
  }
  return name;
}

// Edge (SSD) storage only exists in one region, and the API rewrites the region silently, so a conflicting `--region` is rejected instead.
// Normalizes an explicit region only; without one, createSite picks the default for a fresh zone and a resumed zone keeps its own.
export function resolveSiteRegion(
  region: string | undefined,
  tier?: ZoneTierChoice,
): string | undefined {
  if (!region) return undefined;
  const main = region.toUpperCase();
  if (tier === "ssd" && main !== SSD_PRIMARY_REGION) {
    throw new UserError(
      `The Edge (SSD) tier is only available with ${SSD_PRIMARY_REGION} as the storage region, but --region ${region} was given.`,
      `Drop --region to use ${SSD_PRIMARY_REGION}, or pass --tier hdd to keep ${main}.`,
    );
  }
  return main;
}

/** Run {@link createSite} under a spinner whose text tracks each provisioning step. */
export async function createSiteWithProgress(opts: {
  coreClient: CoreClient;
  name: string;
  region?: string;
  tier?: ZoneTierChoice;
}): Promise<CreateSiteResult> {
  const region = resolveSiteRegion(opts.region, opts.tier);
  return withSpinner(`Creating site "${opts.name}"...`, (spin) =>
    createSite({
      coreClient: opts.coreClient,
      name: opts.name,
      region,
      tier: opts.tier,
      onStep: (message) => {
        spin.text = message;
      },
    }),
  );
}

export async function createLinkedSite(opts: {
  coreClient: CoreClient;
  name: string;
  region?: string;
  tier?: ZoneTierChoice;
}): Promise<SiteContext> {
  const result = await createSiteWithProgress(opts);

  saveManifest<SiteManifest>(SITES_MANIFEST, {
    id: result.state.storageZoneId,
    name: opts.name,
  });

  const context = await siteContextFromZone(result.storageZone);
  if (!context) {
    throw new UserError(
      `Created site "${opts.name}" but couldn't load its state.`,
      "Re-run the command, or `bunny sites link` to retry.",
    );
  }

  logger.success(`Created site "${opts.name}".`);
  return context;
}
