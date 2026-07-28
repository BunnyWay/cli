import prompts from "prompts";
import type { Argv } from "yargs";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, saveManifest } from "../../core/manifest.ts";
import type { OutputFormat } from "../../core/types.ts";
import { confirm, isInteractive, withSpinner } from "../../core/ui.ts";
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
  "Link this directory to the site (prompted when picking one; --no-link never links)";

/** Args contributed by {@link siteOptionBuilder} / {@link sitePositionalBuilder}. */
export interface SiteSelectorArgs {
  site?: string;
  link?: boolean;
}

/** `--site` option, for commands whose positionals are taken. */
export function siteOptionBuilder<T>(
  yargs: Argv<T>,
): Argv<T & SiteSelectorArgs> {
  return yargs.option("site", {
    type: "string",
    describe: ARG_SITE_DESCRIPTION,
  }) as Argv<T & SiteSelectorArgs>;
}

/** Trailing `[site]` positional. Pair with `command: "... [site]"`. */
export function sitePositionalBuilder<T>(
  yargs: Argv<T>,
): Argv<T & SiteSelectorArgs> {
  return yargs.positional("site", {
    type: "string",
    describe: ARG_SITE_DESCRIPTION,
  }) as Argv<T & SiteSelectorArgs>;
}

/** `--link`. Only for commands that call {@link SelectedSite.offerLink}; elsewhere the flag would parse and do nothing. */
export function siteLinkOption<T>(yargs: Argv<T>): Argv<T & SiteSelectorArgs> {
  return yargs.option("link", {
    type: "boolean",
    describe: ARG_LINK_DESCRIPTION,
  }) as Argv<T & SiteSelectorArgs>;
}

// Resolve a ref to a site: a storage zone ID/name directly, else by site name (zone names carry a random suffix, so the site name usually isn't one).
async function contextFromRef(
  client: CoreClient,
  ref: string,
): Promise<SiteContext> {
  let zone: Awaited<ReturnType<typeof resolveStorageZone>> | undefined;
  try {
    zone = await resolveStorageZone(client, ref);
  } catch {
    zone = undefined;
  }
  if (zone) {
    const context = await siteContextFromZone(zone);
    if (context) return context;
  }

  const matches = (await fetchSites(client)).filter(
    (s) => s.state.name.toLowerCase() === ref.toLowerCase(),
  );
  if (matches.length > 1) {
    throw new UserError(
      `Multiple sites are named "${ref}".`,
      "Pass the storage zone ID instead (see `bunny sites list`).",
    );
  }
  const summary = matches[0];
  const context = summary && (await siteContextFromZone(summary.storageZone));
  if (context) return context;

  if (zone) {
    throw new UserError(
      `Storage zone "${zone.Name}" is not a bunny site.`,
      "Create one with `bunny sites create <name>`.",
    );
  }
  throw new UserError(
    `No site found for "${ref}".`,
    "Run `bunny sites list` to see your sites, or create one with `bunny sites create <name>`.",
  );
}

export interface SelectedSite {
  site: SiteContext;
  // Link the directory to the site: prompted when it came from the picker, silent when `--link` asked for it, a no-op otherwise, so commands can always call it.
  offerLink: () => Promise<void>;
}

function linkDirectory(site: SiteContext): void {
  saveManifest<SiteManifest>(SITES_MANIFEST, {
    id: site.state.storageZoneId,
    name: site.state.name,
  });
  logger.success(`Linked to ${site.state.name} (${site.state.storageZoneId}).`);
}

// Resolve the site a command acts on, in precedence order: explicit ref, `.bunny/site.json`, `sites.name` in bunny.jsonc, interactive picker (non-interactive runs fail with a hint instead of hanging). `offerCreate` (deploy only) adds a "new site" branch returning a ready, already-linked context. Destructive commands pass their `--force` to opt out of the picker.
export async function selectSite(
  client: CoreClient,
  args: SiteSelectorArgs & {
    output: OutputFormat;
    force?: boolean;
    offerCreate?: () => Promise<SiteContext>;
  },
): Promise<SelectedSite> {
  const noLink = async () => {};
  // A site resolved from a ref or from bunny.jsonc isn't prompted about, but an explicit `--link` still asks for it to be linked.
  const linkIfRequested = (site: SiteContext) => async () => {
    if (args.link === true) linkDirectory(site);
  };

  if (args.site) {
    const ref = args.site;
    const site = await withSpinner("Resolving site...", () =>
      contextFromRef(client, ref),
    );
    return { site, offerLink: linkIfRequested(site) };
  }

  const manifest = loadManifest<SiteManifest>(SITES_MANIFEST);
  if (manifest.id) {
    const id = manifest.id;
    const context = await withSpinner("Loading linked site...", async () =>
      siteContextFromZone(await fetchStorageZone(client, id)),
    );
    if (!context) {
      throw new UserError(
        `The linked storage zone ${id} is no longer a bunny site.`,
        "Run `bunny sites unlink`, then link or create a site.",
      );
    }
    return { site: context, offerLink: noLink };
  }

  const configured = loadSiteConfig()?.config.name;
  if (configured) {
    const site = await withSpinner(
      `Resolving site "${configured}" from bunny.jsonc...`,
      () => contextFromRef(client, configured),
    );
    return { site, offerLink: linkIfRequested(site) };
  }

  // `--force` skips the confirmation too, so picking a site from a list would act on it unprompted.
  if (args.force || !isInteractive(args.output)) {
    throw new UserError(
      "No site specified and no linked site found.",
      "Pass a site name or run `bunny sites link`.",
    );
  }

  const sites = await withSpinner("Fetching sites...", () =>
    fetchSites(client),
  );

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
      if (shouldLink) linkDirectory(context);
    },
  };
}
