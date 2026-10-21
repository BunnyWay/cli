import { basename } from "node:path";
import type { CoreClient } from "@/commands/storage/api.ts";
import {
  loadStorageRegions,
  mainRegionChoices,
  scopeLabel,
  type ZoneTierChoice,
} from "@/commands/storage/constants.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { prompts, withSpinner } from "@/core/ui.ts";
import type { StorageRegionOption } from "@/tools/storage/index.ts";
import { type CreateSiteResult, createSite, type SiteContext } from "./api.ts";
import { isValidSiteName } from "./constants.ts";
import { saveSiteLink } from "./interactive.ts";

const SITE_NAME_RULES =
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

// The API silently rewrites an unsupported main region, so a conflicting `--region` is rejected instead.
// Normalizes an explicit region only; without one, createSite picks the default for a fresh zone and a resumed zone keeps its own.
export function resolveSiteRegion(
  catalog: StorageRegionOption[],
  region: string | undefined,
  tier?: ZoneTierChoice,
): string | undefined {
  if (!region) return undefined;
  const main = region.toUpperCase();
  const allowed = mainRegionChoices(catalog, { tier }).map((r) => r.code);
  if (!allowed.includes(main)) {
    throw new UserError(
      `${main} cannot be the storage region of ${scopeLabel({ tier })} sites.`,
      tier === "ssd"
        ? `Use ${allowed.join(", ")}, or pass --tier hdd to keep ${main}.`
        : `Available regions: ${allowed.join(", ")}.`,
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
  const region = opts.region
    ? resolveSiteRegion(
        await loadStorageRegions(opts.coreClient),
        opts.region,
        opts.tier,
      )
    : undefined;
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
  const site = await createSiteWithProgress(opts);
  saveSiteLink(site.state);
  logger.success(`Created site "${opts.name}".`);
  return site;
}
