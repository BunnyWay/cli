import { basename } from "node:path";
import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { withSpinner } from "../../core/ui.ts";
import type { CoreClient } from "../storage/api.ts";
import {
  type ComputeClient,
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
  "Use 3-60 lowercase letters, digits, and dashes (no leading/trailing dash).";

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

/** Run {@link createSite} under a spinner whose text tracks each provisioning step. */
export async function createSiteWithProgress(opts: {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  name: string;
  region?: string;
}): Promise<CreateSiteResult> {
  return withSpinner(`Creating site "${opts.name}"...`, (spin) =>
    createSite({
      coreClient: opts.coreClient,
      computeClient: opts.computeClient,
      name: opts.name,
      region: (opts.region ?? "DE").toUpperCase(),
      onStep: (message) => {
        spin.text = message;
      },
    }),
  );
}

export async function createLinkedSite(opts: {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  name: string;
  region?: string;
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
