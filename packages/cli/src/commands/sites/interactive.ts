import prompts from "prompts";
import type { Argv } from "yargs";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, saveManifest } from "../../core/manifest.ts";
import type { OutputFormat } from "../../core/types.ts";
import { confirm, isInteractive, spinner } from "../../core/ui.ts";
import {
  type CoreClient,
  fetchStorageZone,
  resolveStorageZone,
} from "../storage/api.ts";
import { fetchSites, type SiteContext, siteContextFromZone } from "./api.ts";
import { loadSiteConfig } from "./config.ts";
import { SITES_MANIFEST, type SiteManifest } from "./constants.ts";

const ARG_SITE_DESCRIPTION =
  "Site name or storage zone ID (uses the linked site if omitted)";
const ARG_LINK_DESCRIPTION =
  "Link the directory to the picked site (use --no-link to skip the prompt)";

/** Args contributed by {@link siteOptionBuilder} / {@link sitePositionalBuilder}. */
export interface SiteSelectorArgs {
  site?: string;
  link?: boolean;
}

/** `--site` option + `--link`, for commands whose positionals are taken. */
export function siteOptionBuilder<T>(
  yargs: Argv<T>,
): Argv<T & SiteSelectorArgs> {
  return yargs
    .option("site", { type: "string", describe: ARG_SITE_DESCRIPTION })
    .option("link", {
      type: "boolean",
      describe: ARG_LINK_DESCRIPTION,
    }) as Argv<T & SiteSelectorArgs>;
}

/** Trailing `[site]` positional + `--link`. Pair with `command: "... [site]"`. */
export function sitePositionalBuilder<T>(
  yargs: Argv<T>,
): Argv<T & SiteSelectorArgs> {
  return yargs
    .positional("site", { type: "string", describe: ARG_SITE_DESCRIPTION })
    .option("link", {
      type: "boolean",
      describe: ARG_LINK_DESCRIPTION,
    }) as Argv<T & SiteSelectorArgs>;
}

async function contextFromRef(
  client: CoreClient,
  ref: string,
): Promise<SiteContext> {
  const zone = await resolveStorageZone(client, ref);
  const context = await siteContextFromZone(zone);
  if (!context) {
    throw new UserError(
      `Storage zone "${zone.Name}" is not a bunny site.`,
      "Create one with `bunny sites create <name>`.",
    );
  }
  return context;
}

export interface SelectedSite {
  site: SiteContext;
  /**
   * Offer to link the directory to the site — only when it was chosen via the
   * interactive picker. A no-op otherwise, so commands can always call it
   * after their own output.
   */
  offerLink: () => Promise<void>;
}

/**
 * Resolve the site a command acts on.
 *
 * Precedence: explicit ref (flag or positional) → `.bunny/site.json` →
 * `sites.name` in bunny.jsonc → interactive picker. Non-interactive runs
 * without a resolvable site fail with a hint instead of hanging on a prompt.
 *
 * `offerCreate` (deploy only) adds a "new site" branch to the picker: it runs
 * when the account has no sites, or when the user picks "a new site" over the
 * existing list. It returns a ready, already-linked context.
 */
export async function selectSite(
  client: CoreClient,
  args: SiteSelectorArgs & {
    output: OutputFormat;
    offerCreate?: () => Promise<SiteContext>;
  },
): Promise<SelectedSite> {
  const noLink = async () => {};

  if (args.site) {
    const spin = spinner("Resolving site...");
    spin.start();
    try {
      return {
        site: await contextFromRef(client, args.site),
        offerLink: noLink,
      };
    } finally {
      spin.stop();
    }
  }

  const manifest = loadManifest<SiteManifest>(SITES_MANIFEST);
  if (manifest.id) {
    const spin = spinner("Loading linked site...");
    spin.start();
    try {
      const zone = await fetchStorageZone(client, manifest.id);
      const context = await siteContextFromZone(zone);
      if (!context) {
        throw new UserError(
          `The linked storage zone ${manifest.id} is no longer a bunny site.`,
          "Run `bunny sites unlink`, then link or create a site.",
        );
      }
      return { site: context, offerLink: noLink };
    } finally {
      spin.stop();
    }
  }

  const configured = loadSiteConfig()?.config.name;
  if (configured) {
    const spin = spinner(`Resolving site "${configured}" from bunny.jsonc...`);
    spin.start();
    try {
      return {
        site: await contextFromRef(client, configured),
        offerLink: noLink,
      };
    } finally {
      spin.stop();
    }
  }

  if (!isInteractive(args.output)) {
    throw new UserError(
      "No site specified and no linked site found.",
      "Pass a site name or run `bunny sites link`.",
    );
  }

  const spin = spinner("Fetching sites...");
  spin.start();
  let sites: Awaited<ReturnType<typeof fetchSites>>;
  try {
    sites = await fetchSites(client);
  } finally {
    spin.stop();
  }

  // Deploy offers to create a site here; other commands only pick an existing one.
  if (args.offerCreate) {
    if (sites.length === 0) {
      return { site: await args.offerCreate(), offerLink: noLink };
    }
    const { mode } = await prompts({
      type: "select",
      name: "mode",
      message: "Deploy to:",
      choices: [
        { title: "A new site", value: "new" },
        { title: "An existing site", value: "existing" },
      ],
      initial: 0,
    });
    if (!mode) throw new UserError("A site is required.");
    if (mode === "new") {
      return { site: await args.offerCreate(), offerLink: noLink };
    }
  } else if (sites.length === 0) {
    throw new UserError(
      "No sites found in your account.",
      "Create one with `bunny sites create <name>`.",
    );
  }

  const { selected } = await prompts({
    type: "select",
    name: "selected",
    message: "Select a site:",
    choices: sites.map((s) => ({
      title: `${s.state.name} (${s.state.storageZoneId})`,
      value: s,
    })),
  });
  if (!selected) throw new UserError("A site is required.");

  const summary = selected as (typeof sites)[number];
  const context = await siteContextFromZone(summary.storageZone);
  if (!context) {
    throw new UserError(`Site "${summary.state.name}" could not be loaded.`);
  }

  return {
    site: context,
    offerLink: async () => {
      const shouldLink =
        args.link !== undefined
          ? args.link
          : await confirm(`Link this directory to ${context.state.name}?`);
      if (!shouldLink) return;
      saveManifest<SiteManifest>(SITES_MANIFEST, {
        id: context.state.storageZoneId,
        name: context.state.name,
      });
      logger.success(
        `Linked to ${context.state.name} (${context.state.storageZoneId}).`,
      );
    },
  };
}
