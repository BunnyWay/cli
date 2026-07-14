import { basename } from "node:path";
import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import type { CoreClient } from "../storage/api.ts";
import {
  type ComputeClient,
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
  "Use 3–60 lowercase letters, digits, and dashes (no leading/trailing dash).";

/** Best-effort site name from the current directory, or undefined if it can't be one. */
export function suggestSiteName(): string | undefined {
  const base = basename(process.cwd())
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return isValidSiteName(base) ? base : undefined;
}

/**
 * Resolve a site name: normalize a passed one, else prompt (defaulting to the
 * directory name). Throws with `missingHint` when no name is available and we
 * can't prompt.
 */
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

/**
 * Create a new site and link this directory to it, returning the ready context.
 * The provisioning-only path behind the deploy picker's "new site" branch: it
 * skips the custom-domain and CI prompts that `sites create` layers on top.
 */
export async function createLinkedSite(opts: {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  name: string;
  region?: string;
}): Promise<SiteContext> {
  const spin = spinner(`Creating site "${opts.name}"...`);
  spin.start();
  let result: Awaited<ReturnType<typeof createSite>>;
  try {
    result = await createSite({
      coreClient: opts.coreClient,
      computeClient: opts.computeClient,
      name: opts.name,
      region: (opts.region ?? "DE").toUpperCase(),
      onStep: (message) => {
        spin.text = message;
      },
    });
  } finally {
    spin.stop();
  }

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
