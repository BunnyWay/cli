import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { errorMessage } from "../../../core/errors.ts";
import {
  addHostname,
  type CoreClient,
  createHostnamesCommands,
  enableSsl,
  type Hostname,
  type ResolvedPullZone,
  setupHostname,
} from "../../../core/hostnames/index.ts";
import { logger } from "../../../core/logger.ts";
import type { GlobalArgs } from "../../../core/types.ts";
import { type SiteContext, writeRemoteState } from "../api.ts";
import { PREVIEW_LABEL, previewWildcard } from "../constants.ts";
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

function isPreviewHost(hostname: string): boolean {
  return (
    hostname.startsWith("*.") ||
    hostname.includes(`.${PREVIEW_LABEL}.`) ||
    hostname.startsWith(`${PREVIEW_LABEL}.`)
  );
}

/** Persist the site's primary domain in the remote state (best-effort; rolls back the in-memory value on failure so it never claims previews the next run won't see). */
async function recordSiteDomain(
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

// Attach the `*.preview.<domain>` wildcard that serves per-deploy previews; returns whether the hostname attached (SSL may still be pending), since `state.domain` must only be recorded when previews can actually serve.
export async function attachPreviewWildcard(opts: {
  coreClient: CoreClient;
  pullZoneId: number;
  domain: string;
  cnameTarget?: string;
  json?: boolean;
}): Promise<boolean> {
  const wildcard = previewWildcard(opts.domain);
  let hostnames: Hostname[];
  let alreadyAttached: boolean;
  try {
    // A retry after a partial setup re-adds an existing wildcard; addHostname reconciles that against the zone instead of failing.
    ({ hostnames, alreadyAttached } = await addHostname(
      opts.coreClient,
      opts.pullZoneId,
      wildcard,
    ));
  } catch (err) {
    if (!opts.json) {
      logger.warn(`Couldn't add ${wildcard}: ${errorMessage(err)}`);
      logger.dim(
        `  Previews stay off and deploys keep publishing directly; retry with \`bunny sites domains add ${opts.domain}\`.`,
      );
    }
    return false;
  }
  if (!opts.json) {
    if (alreadyAttached) {
      logger.info(`${wildcard} is already attached for deploy previews.`);
    } else {
      logger.success(`Added ${wildcard} for deploy previews.`);
      if (opts.cnameTarget) {
        logger.accent(`  CNAME  ${wildcard}  →  ${opts.cnameTarget}`);
      }
    }
  }

  // A retry on an already-certified wildcard skips issuance; re-running it would print a bogus pending hint.
  const certified = hostnames.some(
    (h) =>
      (h.Value ?? "").toLowerCase() === wildcard.toLowerCase() &&
      h.HasCertificate,
  );
  if (!certified) {
    try {
      await enableSsl(
        opts.coreClient,
        opts.pullZoneId,
        wildcard,
        true,
        hostnames,
      );
    } catch {
      // Wildcard certs need DNS in place (DNS-01); issue later, don't block. Deploys print http:// preview URLs until it lands.
      if (!opts.json) {
        logger.dim(
          `  Preview HTTPS pending; once DNS is live: bunny sites domains ssl "${wildcard}"`,
        );
      }
    }
  }
  return true;
}

// Full custom-domain setup for a site (used by `sites create --domain`): interactive runs get the DNS-wait/SSL flow, JSON runs just attach and report; the preview wildcard and state update happen in both.
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

  let cnameTarget: string | undefined;
  if (opts.json) {
    const added = await addHostname(coreClient, pullZoneId, domain);
    cnameTarget = added.cnameTarget;
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
  }

  // `state.domain` switches deploy and CI into preview mode, so it's only recorded once the wildcard can serve previews.
  const wildcardAttached = await attachPreviewWildcard({
    coreClient,
    pullZoneId,
    domain,
    cnameTarget,
    json: opts.json,
  });
  if (wildcardAttached) await recordSiteDomain(site, domain);
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
  onAdded: async ({ coreClient, pullZoneId, hostname, cnameTarget, args }) => {
    // Adding preview infrastructure by hand shouldn't recurse into itself.
    if (isPreviewHost(hostname)) return;
    const wildcardAttached = await attachPreviewWildcard({
      coreClient,
      pullZoneId,
      domain: hostname,
      cnameTarget,
      json: args.output === "json",
    });
    if (wildcardAttached && resolvedSite && !resolvedSite.state.domain) {
      await recordSiteDomain(resolvedSite, hostname);
    }
  },
  onRemoved: async ({ coreClient, pullZoneId, hostname }) => {
    if (isPreviewHost(hostname)) return;
    // Take the companion wildcard down with the apex.
    try {
      await coreClient.DELETE("/pullzone/{id}/removeHostname", {
        params: { path: { id: pullZoneId } },
        body: { Hostname: previewWildcard(hostname) },
      });
    } catch {
      // Already gone (or never added); nothing to clean up.
    }
    if (resolvedSite?.state.domain === hostname) {
      await recordSiteDomain(resolvedSite, undefined);
    }
  },
});
