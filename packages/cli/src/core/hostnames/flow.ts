import { UserError } from "../errors.ts";
import { logger } from "../logger.ts";
import { confirm, spinner, withSpinner } from "../ui.ts";
import {
  type BunnyDnsMatch,
  findBunnyDnsZone,
  offerBunnyDnsRecord,
} from "./bunny-dns.ts";
import {
  addHostname,
  type CoreClient,
  enableSsl,
  hostnameUrl,
  probeTlsCertificate,
} from "./client.ts";
import { anyResolverPointsAt, defaultResolvers } from "./dns.ts";

const DNS_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
// Try issuing every ~30s even before DNS looks live here — bunny's resolvers may see the record first.
const OPPORTUNISTIC_EVERY_TICKS = 6;
const SSL_ATTEMPTS = 3;
const SSL_RETRY_DELAY_MS = 10_000;

function formatElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export interface DnsSslFlowOptions {
  coreClient: CoreClient;
  pullZoneId: number;
  hostname: string;
  /** The system hostname the user's CNAME should point at. */
  cnameTarget: string;
  /** Force HTTP→HTTPS once the certificate is issued. */
  forceSsl: boolean;
  /** Copy-paste command for issuing SSL later, shown when declining or giving up. */
  sslHint: string;
  /** Skip the confirmation prompt and start waiting immediately (e.g. --wait). */
  assumeYes?: boolean;
  /** Skip the wait prompt and DNS poll, issuing SSL right away (record already live on bunny's resolvers). */
  dnsAlreadyLive?: boolean;
  /** Suppress the human-readable summary on stdout (the caller emits JSON instead). */
  json?: boolean;
}

/** Print the manual follow-up for enabling HTTPS once DNS propagates. */
export function printSslHint(sslHint: string): void {
  logger.log("Then enable HTTPS once DNS is live:");
  logger.accent(`  ${sslHint}`);
}

// One retry: a certificate issued a moment ago can still be rolling out to the edge.
const TLS_PROBE_RETRY_DELAY_MS = 5_000;

/**
 * Print the issued-certificate summary, but verify the edge actually answers
 * with a valid certificate first (best effort). Issuance can succeed while
 * serving stays broken, e.g. when a single-label wildcard hostname elsewhere
 * on the account shadows a deeper subdomain; that must warn, not claim "Live".
 */
export async function reportIssuedCertificate(
  hostname: string,
  forceSsl: boolean,
): Promise<void> {
  logger.success(
    forceSsl
      ? `SSL certificate issued for ${hostname} and HTTPS forced.`
      : `SSL certificate issued for ${hostname}.`,
  );

  // A wildcard has no probeable name; trust issuance for it.
  if (hostname.includes("*")) return;

  const probe = await withSpinner("Verifying HTTPS...", async () => {
    const first = await probeTlsCertificate(hostname);
    if (first !== "bad-certificate") return first;
    await Bun.sleep(TLS_PROBE_RETRY_DELAY_MS);
    return probeTlsCertificate(hostname);
  });

  if (probe === "bad-certificate") {
    logger.warn(`HTTPS for ${hostname} isn't serving a valid certificate yet.`);
    logger.dim(
      "  Fresh certificates can take a minute to reach the edge. If this persists, another hostname (often a wildcard on a different pull zone) may be answering for this name.",
    );
    logger.dim(`  Check again with: curl -vI https://${hostname}`);
    return;
  }

  logger.log(`  Live at: ${hostnameUrl(hostname, { hasCertificate: true })}`);
}

/**
 * Offer to wait for the domain's DNS to point at bunny.net, then issue a
 * free SSL certificate automatically. Polls DNS every few seconds (system
 * and public resolvers) for up to 10 minutes, and periodically attempts
 * issuance outright — bunny's resolvers decide validation, and may see the
 * record before or after this machine's caches do.
 *
 * Returns `true` when a certificate was issued, `false` when the user
 * declined to wait. Throws a UserError on timeout or issuance failure.
 */
export async function offerDnsWaitAndSsl(
  opts: DnsSslFlowOptions,
): Promise<boolean> {
  const shouldWait =
    opts.dnsAlreadyLive ||
    opts.assumeYes ||
    (await confirm("Wait for DNS and enable HTTPS now?", {
      initial: true,
      optional: true,
    }));

  if (!shouldWait) {
    printSslHint(opts.sslHint);
    return false;
  }

  if (!opts.dnsAlreadyLive) {
    logger.dim("  Checking every 5s — Ctrl+C to stop and finish later.");
  }

  const waitText = `Waiting for DNS (${opts.hostname} → ${opts.cnameTarget})...`;
  const spin = spinner(
    opts.dnsAlreadyLive ? "Requesting free SSL certificate..." : waitText,
  );
  spin.start();

  const tryIssue = () =>
    enableSsl(opts.coreClient, opts.pullZoneId, opts.hostname, opts.forceSsl);

  const resolvers = defaultResolvers();
  const startedAt = Date.now();
  let dnsLive = opts.dnsAlreadyLive ?? false;
  let issued = false;
  let lastError: unknown;

  for (
    let tick = 0;
    !dnsLive && Date.now() - startedAt < DNS_TIMEOUT_MS;
    tick++
  ) {
    if (await anyResolverPointsAt(opts.hostname, opts.cnameTarget, resolvers)) {
      dnsLive = true;
      break;
    }

    if (tick > 0 && tick % OPPORTUNISTIC_EVERY_TICKS === 0) {
      try {
        await tryIssue();
        issued = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    spin.text = `${waitText} ${formatElapsed(Date.now() - startedAt)}`;
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  if (!dnsLive && !issued) {
    spin.stop();
    throw new UserError(
      `DNS for ${opts.hostname} hasn't propagated yet (gave up after 10 minutes).`,
      `Once it's live, run: ${opts.sslHint}`,
    );
  }

  if (!issued) {
    spin.text = "DNS is live. Requesting free SSL certificate...";

    for (let attempt = 1; attempt <= SSL_ATTEMPTS; attempt++) {
      try {
        await tryIssue();
        issued = true;
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < SSL_ATTEMPTS) {
          spin.text = `Certificate not ready yet (attempt ${attempt}/${SSL_ATTEMPTS}) — retrying...`;
          await Bun.sleep(SSL_RETRY_DELAY_MS);
        }
      }
    }
  }

  spin.stop();

  if (!issued) {
    const message =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new UserError(
      `DNS is live, but the certificate couldn't be issued: ${message}`,
      `Try again in a minute: ${opts.sslHint}`,
    );
  }

  if (!opts.json) {
    logger.success("DNS is live.");
    await reportIssuedCertificate(opts.hostname, opts.forceSsl);
  }
  return true;
}

/**
 * When the domain is on Bunny DNS, offer (prompted) to point a record at the
 * pull zone, then run the wait/SSL flow. Returns whether a certificate was
 * issued, or null when the domain isn't on Bunny DNS or the user declined — in
 * which case the caller should fall back to manual CNAME instructions.
 *
 * Only zone detection is wrapped: an unreachable Bunny DNS API degrades to
 * manual setup. Once a zone matches, the record offer and wait/SSL flow run
 * outside the catch, so a write the user just confirmed (or a propagation
 * timeout) surfaces instead of being mistaken for a detection hiccup.
 *
 * When the matched zone isn't delegated, the just-added PULLZONE record can't
 * resolve publicly (only bunny's nameservers serve it), so we point the user at
 * their registrar instead of starting a poll that would time out after 10 min.
 */
/**
 * Add a hostname to a pull zone, then wire up DNS and a free SSL certificate.
 * Tries the Bunny DNS auto-record path first (when the domain is on Bunny DNS),
 * otherwise prints the CNAME to set and offers to wait for propagation.
 *
 * Returns `true` when a certificate was issued. Resource-agnostic: the caller
 * supplies the copy-paste `sslHint`/`retryHint` for its own command surface.
 */
export async function setupHostname(opts: {
  coreClient: CoreClient;
  pullZoneId: number;
  domain: string;
  /** Copy-paste command to issue SSL later (shown when declining or on manual DNS). */
  sslHint: string;
  /** Copy-paste command to retry adding the hostname (shown if the add fails). */
  retryHint?: string;
  forceSsl: boolean;
  interactive: boolean;
  verbose: boolean;
  onBunnyDnsZone?: (zone: {
    id: number;
    domain: string;
  }) => void | Promise<void>;
}): Promise<boolean> {
  const spin = spinner(`Adding ${opts.domain}...`);
  spin.start();

  let cnameTarget: string | undefined;
  let alreadyAttached = false;
  try {
    ({ cnameTarget, alreadyAttached } = await addHostname(
      opts.coreClient,
      opts.pullZoneId,
      opts.domain,
    ));
  } catch (err) {
    spin.stop();
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Couldn't add ${opts.domain}: ${message}`);
    if (opts.retryHint) logger.dim(`  Retry: ${opts.retryHint}`);
    return false;
  }

  spin.stop();
  if (alreadyAttached) {
    logger.info(
      `${opts.domain} is already on pull zone ${opts.pullZoneId}; finishing setup.`,
    );
  } else {
    logger.success(`Added ${opts.domain} to pull zone ${opts.pullZoneId}.`);
  }
  if (!cnameTarget) return false;

  if (opts.interactive) {
    const issued = await offerBunnyDnsThenSsl({
      coreClient: opts.coreClient,
      hostname: opts.domain,
      pullZoneId: opts.pullZoneId,
      cnameTarget,
      forceSsl: opts.forceSsl,
      sslHint: opts.sslHint,
      verbose: opts.verbose,
      onBunnyDnsZone: opts.onBunnyDnsZone,
    });
    if (issued !== null) return issued;
  }

  logger.log();
  logger.log("Point your DNS at bunny.net to activate it:");
  logger.accent(`  CNAME  ${opts.domain}  ->  ${cnameTarget}`);
  logger.log();

  if (!opts.interactive) {
    printSslHint(opts.sslHint);
    return false;
  }

  return offerDnsWaitAndSsl({
    coreClient: opts.coreClient,
    pullZoneId: opts.pullZoneId,
    hostname: opts.domain,
    cnameTarget,
    forceSsl: opts.forceSsl,
    sslHint: opts.sslHint,
  });
}

export async function offerBunnyDnsThenSsl(opts: {
  coreClient: CoreClient;
  hostname: string;
  pullZoneId: number;
  cnameTarget: string;
  forceSsl: boolean;
  sslHint: string;
  verbose: boolean;
  /** Invoked with the owning zone when the hostname is on Bunny DNS — lets the caller link the directory. */
  onBunnyDnsZone?: (zone: {
    id: number;
    domain: string;
  }) => void | Promise<void>;
}): Promise<boolean | null> {
  let match: BunnyDnsMatch | null;
  try {
    match = await findBunnyDnsZone(opts.coreClient, opts.hostname);
  } catch (err) {
    // Detecting the zone failed (API unreachable, etc.) — fall back to manual DNS.
    if (opts.verbose) {
      const message = err instanceof Error ? err.message : String(err);
      logger.dim(`  Bunny DNS check skipped: ${message}`);
    }
    return null;
  }
  if (!match) return null;

  await opts.onBunnyDnsZone?.({ id: match.zoneId, domain: match.zoneDomain });

  const dnsResult = await offerBunnyDnsRecord({
    client: opts.coreClient,
    hostname: opts.hostname,
    pullZoneId: opts.pullZoneId,
    match,
  });
  if (dnsResult === "declined") return null;

  // An undelegated zone's PULLZONE record never reaches public resolvers, so
  // skip the doomed poll and tell the user to delegate at their registrar.
  if (!match.delegated) {
    logger.log();
    logger.warn(
      `${match.zoneDomain} isn't delegated to bunny.net's nameservers yet.`,
    );
    logger.dim(
      "  The record is set, but won't resolve (or get a certificate) until your registrar points at bunny.net.",
    );
    logger.log();
    logger.log("Set these nameservers at your registrar:");
    for (const ns of match.nameservers) logger.accent(`  ${ns}`);
    logger.log();
    logger.dim(
      `Check delegation later with:\n  bunny dns zones ns ${match.zoneDomain}`,
    );
    printSslHint(opts.sslHint);
    return false;
  }

  logger.log();
  return offerDnsWaitAndSsl({
    coreClient: opts.coreClient,
    pullZoneId: opts.pullZoneId,
    hostname: opts.hostname,
    cnameTarget: opts.cnameTarget,
    forceSsl: opts.forceSsl,
    sslHint: opts.sslHint,
    dnsAlreadyLive: true,
  });
}
