import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import {
  addHostname,
  type CoreClient,
  createHostnamesCommands,
  enableSsl,
  type ResolvedPullZone,
  setupHostname,
} from "../../../core/hostnames/index.ts";
import { logger } from "../../../core/logger.ts";
import type { GlobalArgs } from "../../../core/types.ts";
import { type SiteContext, writeRemoteState } from "../api.ts";
import { PREVIEW_LABEL, previewWildcard } from "../constants.ts";
import { selectSite } from "../interactive.ts";

// The hooks run in the same invocation as `resolve`, so the resolved site is
// cached here — a CLI process handles exactly one command.
let resolvedSite: SiteContext | null = null;

async function resolveSitePullZone(
  args: GlobalArgs & Record<string, unknown>,
): Promise<ResolvedPullZone> {
  const config = resolveConfig(args.profile, args.apiKey, args.verbose);
  const coreClient = createCoreClient(clientOptions(config, args.verbose));

  const { site } = await selectSite(coreClient, {
    site: args.site as string | undefined,
    link: false,
    output: args.output,
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

/** Persist the site's primary domain in the remote state (best-effort). */
async function recordSiteDomain(
  site: SiteContext,
  domain: string | undefined,
): Promise<void> {
  try {
    site.state.domain = domain;
    site.etag = await writeRemoteState(site.connection, site.state, site.etag);
  } catch (err) {
    logger.warn(
      `Couldn't update the site state: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Attach the `*.preview.<domain>` wildcard that serves per-deploy previews.
 * Best-effort by design: the apex is already added, and the wildcard can be
 * retried by re-running `sites domains add`.
 */
export async function attachPreviewWildcard(opts: {
  coreClient: CoreClient;
  pullZoneId: number;
  domain: string;
  cnameTarget?: string;
  json?: boolean;
}): Promise<void> {
  const wildcard = previewWildcard(opts.domain);
  try {
    const { hostnames } = await addHostname(
      opts.coreClient,
      opts.pullZoneId,
      wildcard,
    );
    if (!opts.json) {
      logger.success(`Added ${wildcard} for deploy previews.`);
      if (opts.cnameTarget) {
        logger.accent(`  CNAME  ${wildcard}  →  ${opts.cnameTarget}`);
      }
    }
    try {
      await enableSsl(
        opts.coreClient,
        opts.pullZoneId,
        wildcard,
        true,
        hostnames,
      );
    } catch {
      // Wildcard certs need DNS in place (DNS-01); issue later, don't block.
      if (!opts.json) {
        logger.dim(
          `  Preview HTTPS pending — once DNS is live: bunny sites domains ssl "${wildcard}"`,
        );
      }
    }
  } catch (err) {
    if (!opts.json) {
      logger.warn(
        `Couldn't add ${wildcard}: ${err instanceof Error ? err.message : err}`,
      );
      logger.dim("  Previews will use /deploys/<id>/ paths until it's added.");
    }
  }
}

/**
 * Full custom-domain setup for a site — used by `sites create --domain`.
 * Interactive runs get the DNS-wait/SSL flow; JSON runs just attach and
 * report. The preview wildcard and state update happen in both.
 */
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

  await attachPreviewWildcard({
    coreClient,
    pullZoneId,
    domain,
    cnameTarget,
    json: opts.json,
  });
  await recordSiteDomain(site, domain);
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
    await attachPreviewWildcard({
      coreClient,
      pullZoneId,
      domain: hostname,
      cnameTarget,
      json: args.output === "json",
    });
    if (resolvedSite && !resolvedSite.state.domain) {
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
      // Already gone (or never added) — nothing to clean up.
    }
    if (resolvedSite?.state.domain === hostname) {
      await recordSiteDomain(resolvedSite, undefined);
    }
  },
});
