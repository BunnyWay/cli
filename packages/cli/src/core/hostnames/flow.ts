import { UserError } from "../errors.ts";
import { logger } from "../logger.ts";
import { confirm, spinner } from "../ui.ts";
import {
  type BunnyDnsMatch,
  findBunnyDnsZone,
  offerBunnyDnsRecord,
} from "./bunny-dns.ts";
import { type CoreClient, enableSsl, hostnameUrl } from "./client.ts";
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
    (await confirm("Wait for DNS and enable HTTPS now?", { initial: true }));

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
    logger.success(
      opts.forceSsl
        ? `SSL certificate issued for ${opts.hostname} and HTTPS forced.`
        : `SSL certificate issued for ${opts.hostname}.`,
    );
    logger.log(
      `  Live at: ${hostnameUrl(opts.hostname, { hasCertificate: true })}`,
    );
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
export async function offerBunnyDnsThenSsl(opts: {
  coreClient: CoreClient;
  hostname: string;
  pullZoneId: number;
  cnameTarget: string;
  forceSsl: boolean;
  sslHint: string;
  verbose: boolean;
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
      "  The record is set, but won't resolve (or get a certificate) until you point your registrar at bunny.net.",
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
