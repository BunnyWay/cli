import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, saveManifest } from "../../core/manifest.ts";
import type { OutputFormat } from "../../core/types.ts";
import { confirm, isInteractive, spinner } from "../../core/ui.ts";
import {
  type CoreClient,
  type DnsRecordModel,
  type DnsZoneModel,
  fetchZone,
  fetchZones,
  resolveZone,
} from "./api.ts";
import { DNS_MANIFEST, type DnsManifest } from "./constants.ts";
import {
  formatRecordValue,
  recordName,
  recordTypeLabel,
} from "./record-types.ts";

function writeDnsManifest(id: number, domain: string | undefined): void {
  saveManifest<DnsManifest>(DNS_MANIFEST, { id, domain });
  logger.success(`Linked this directory to DNS zone ${domain ?? id}.`);
}

/** Offer to remember a zone picked from the prompt; a no-op if the user declines. */
async function maybeLinkZone(zone: DnsZoneModel): Promise<void> {
  if (!(await confirm(`Link this directory to ${zone.Domain}?`))) return;
  writeDnsManifest(zone.Id as number, zone.Domain ?? undefined);
}

/**
 * Link a directory to a zone discovered during another flow (e.g. setting up a
 * script's custom domain). Writes silently when nothing is linked yet, confirms
 * before replacing a different linked zone, and no-ops when already linked here.
 */
export async function autoLinkDnsZone(zone: {
  id: number;
  domain?: string;
}): Promise<void> {
  const existing = loadManifest<DnsManifest>(DNS_MANIFEST);
  if (existing.id === zone.id) return;
  if (
    existing.id &&
    !(await confirm(
      `This directory is linked to DNS zone ${existing.domain ?? existing.id}. Relink to ${zone.domain ?? zone.id}?`,
    ))
  ) {
    return;
  }
  writeDnsManifest(zone.id, zone.domain);
}

/**
 * Resolve a zone by name/ID, or prompt the user to pick one when no
 * reference is given. Manages its own spinner so it never spins over a prompt.
 *
 * When `offerLink` is set and the zone is chosen via the picker (not an
 * explicit ref or the existing manifest), offer to link the directory to it.
 * Pass `ignoreManifest` to always pick (used when (re)linking a directory).
 * Never prompts non-interactively (json output or no TTY): errors instead.
 */
export async function resolveZoneInteractive(
  client: CoreClient,
  ref: string | undefined,
  opts: {
    output?: OutputFormat;
    offerLink?: boolean;
    ignoreManifest?: boolean;
  } = {},
): Promise<DnsZoneModel> {
  if (ref) {
    const spin = spinner("Resolving zone...");
    spin.start();
    try {
      return await resolveZone(client, ref);
    } finally {
      spin.stop();
    }
  }

  // Fall back to a directory linked with `bunny dns zones link` before prompting.
  if (!opts.ignoreManifest) {
    const manifest = loadManifest<DnsManifest>(DNS_MANIFEST);
    if (manifest.id) {
      const spin = spinner("Loading linked zone...");
      spin.start();
      try {
        const zone = await fetchZone(client, manifest.id);
        logger.dim(`Using linked zone ${zone.Domain}.`);
        return zone;
      } finally {
        spin.stop();
      }
    }
  }

  if (!isInteractive(opts.output)) {
    throw new UserError(
      "A zone is required.",
      "Pass a domain (e.g. example.com) or link one with `bunny dns zones link`.",
    );
  }

  const spin = spinner("Fetching zones...");
  spin.start();
  let zones: DnsZoneModel[];
  try {
    zones = await fetchZones(client);
  } finally {
    spin.stop();
  }

  if (zones.length === 0) {
    throw new UserError(
      "No DNS zones found.",
      'Create one with "bunny dns zones add <domain>".',
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Zone:",
    choices: zones.map((z) => ({ title: z.Domain ?? "", value: z.Id })),
  });
  if (id === undefined) throw new UserError("A zone is required.");

  const resolveSpin = spinner("Loading zone...");
  resolveSpin.start();
  let zone: DnsZoneModel;
  try {
    zone = await fetchZone(client, id);
  } finally {
    resolveSpin.stop();
  }

  // The picker only runs interactively, so the link offer can't taint machine output.
  if (opts.offerLink) {
    await maybeLinkZone(zone);
  }
  return zone;
}

/**
 * Return the record matching `id`, or prompt the user to pick one from the
 * zone when no ID is given. Never prompts non-interactively: errors instead.
 */
export async function resolveRecordInteractive(
  zone: DnsZoneModel,
  id: number | undefined,
  action: string,
  output?: OutputFormat,
): Promise<DnsRecordModel> {
  const records = zone.Records ?? [];

  if (id !== undefined) {
    const match = records.find((r) => r.Id === id);
    if (!match)
      throw new UserError(`Record ${id} not found in ${zone.Domain}.`);
    return match;
  }

  if (records.length === 0) {
    throw new UserError(`No records in ${zone.Domain}.`);
  }

  if (!isInteractive(output)) {
    throw new UserError(
      "A record ID is required.",
      `Find IDs with \`bunny dns records list ${zone.Domain}\`.`,
    );
  }

  const { record } = await prompts({
    type: "select",
    name: "record",
    message: `Record to ${action}:`,
    choices: records.map((r) => ({
      title: `${recordTypeLabel(r.Type)} ${recordName(r.Name)} → ${formatRecordValue(r)}`,
      value: r,
    })),
  });
  if (!record) throw new UserError("A record is required.");
  return record;
}
