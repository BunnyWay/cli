import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import { spinner } from "../../core/ui.ts";
import {
  type CoreClient,
  type DnsRecordModel,
  type DnsZoneModel,
  fetchZone,
  fetchZones,
  resolveZone,
} from "./api.ts";
import {
  formatRecordValue,
  recordName,
  recordTypeLabel,
} from "./record-types.ts";

/**
 * Resolve a zone by name/ID, or prompt the user to pick one when no
 * reference is given. Manages its own spinner so it never spins over a prompt.
 */
export async function resolveZoneInteractive(
  client: CoreClient,
  ref: string | undefined,
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
      'Create one with "bunny dns zone add <domain>".',
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
  try {
    return await fetchZone(client, id);
  } finally {
    resolveSpin.stop();
  }
}

/**
 * Return the record matching `id`, or prompt the user to pick one from the
 * zone when no ID is given.
 */
export async function resolveRecordInteractive(
  zone: DnsZoneModel,
  id: number | undefined,
  action: string,
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
