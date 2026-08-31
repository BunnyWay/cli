import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { errorMessage } from "../../../core/errors.ts";
import {
  addHostname,
  type CoreClient,
  createHostnamesCommands,
  fetchPullZoneHostnames,
  type ResolvedPullZone,
  setupHostname,
} from "../../../core/hostnames/index.ts";
import { logger } from "../../../core/logger.ts";
import type { GlobalArgs } from "../../../core/types.ts";
import { type SiteContext, writeRemoteState } from "../api.ts";
import { selectSite } from "../interactive.ts";

// The hooks run in the same invocation as `resolve`, so the resolved site is cached here (a CLI process handles exactly one command).
let resolvedSite: SiteContext | null = null;

async function resolveSitePullZone(
  args: GlobalArgs & Record<string, unknown>,
): Promise<ResolvedPullZone> {
  const config = resolveConfig(args.profile, args.apiKey, args.verbose);
  const coreClient = createCoreClient(clientOptions(config, args.verbose));

  // Only `remove` defines --force, so add/ssl/list keep the picker.
  const { site } = await selectSite(coreClient, {
    site: args.site as string | undefined,
    link: false,
    output: args.output,
    force: args.force === true,
  });
  resolvedSite = site;

  return { pullZoneId: site.state.pullZoneId, coreClient };
}

/** Persist the site's production domain in the remote state (best-effort; rolls back the in-memory value on failure so the recorded value always reflects a successful write). */
export async function recordSiteDomain(
  site: SiteContext,
  domain: string | undefined,
): Promise<void> {
  const previous = site.state.domain;
  try {
    site.state.domain = domain;
    site.etag = await writeRemoteState(site.connection, site.state, site.etag);
  } catch (err) {
    site.state.domain = previous;
    logger.warn(`Couldn't update the site state: ${errorMessage(err)}`);
  }
}

// Full custom-domain setup for a site (used by `sites create --domain` and deploy's first-run offer): interactive runs get the DNS-wait/SSL flow, JSON runs just attach and report. The domain is recorded as soon as the hostname is on the zone.
export async function setupSiteDomain(opts: {
  coreClient: CoreClient;
  site: SiteContext;
  domain: string;
  interactive: boolean;
  verbose: boolean;
  json?: boolean;
}): Promise<void> {
  const { coreClient, site, domain } = opts;
  const pullZoneId = site.state.pullZoneId;
  const name = site.state.name;

  let attached: boolean;
  if (opts.json) {
    await addHostname(coreClient, pullZoneId, domain);
    attached = true;
  } else {
    await setupHostname({
      coreClient,
      pullZoneId,
      domain,
      sslHint: `bunny sites domains ssl ${domain} ${name}`,
      retryHint: `bunny sites domains add ${domain} ${name}`,
      forceSsl: true,
      interactive: opts.interactive,
      verbose: opts.verbose,
    });
    // setupHostname's return means "certificate issued", not "attached", so read the zone: a domain that never attached must not be recorded as the production URL.
    const hostnames = await fetchPullZoneHostnames(
      coreClient,
      pullZoneId,
    ).catch(() => null);
    attached =
      hostnames?.some(
        (h) => (h.Value ?? "").toLowerCase() === domain.toLowerCase(),
      ) ?? false;
  }

  if (attached) await recordSiteDomain(site, domain);
}

/** The `domains` namespace + hidden `hostnames` alias, ready to spread into `sites`. */
export const sitesDomainsCommands = createHostnamesCommands({
  commandPath: "sites domains",
  namespace: "domains",
  describe: "Manage custom domains for a site.",
  hiddenAliases: ["hostnames"],
  targetPositional: {
    name: "site",
    describe: "Site name or storage zone ID (uses the linked site if omitted)",
    type: "string",
  },
  resolve: resolveSitePullZone,
  onAdded: async ({ hostname, args }) => {
    // A wildcard is never a site's production URL.
    if (hostname.startsWith("*.")) return;
    // The first custom domain becomes the site's production URL.
    if (resolvedSite && !resolvedSite.state.domain) {
      await recordSiteDomain(resolvedSite, hostname);
    }
    // A domain on a site with nothing published serves the no-deploys page; say so instead of letting the first visit read as breakage.
    if (args.output !== "json" && resolvedSite?.state.current === undefined) {
      logger.dim(
        "  Nothing is published yet, so this domain serves a 404: publish with `bunny sites deploy`.",
      );
    }
  },
  onRemoved: async ({ hostname }) => {
    if (resolvedSite?.state.domain === hostname) {
      await recordSiteDomain(resolvedSite, undefined);
    }
  },
});
