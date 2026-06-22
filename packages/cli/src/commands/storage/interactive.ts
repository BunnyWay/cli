import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import type { OutputFormat } from "../../core/types.ts";
import { spinner } from "../../core/ui.ts";
import {
  type CoreClient,
  fetchStorageZone,
  fetchStorageZones,
  resolveStorageZone,
  type StorageZoneModel,
} from "./api.ts";

export async function resolveStorageZoneInteractive(
  client: CoreClient,
  ref: string | undefined,
  output?: OutputFormat,
): Promise<StorageZoneModel> {
  if (ref) {
    const spin = spinner("Resolving storage zone...");
    spin.start();
    try {
      return await resolveStorageZone(client, ref);
    } finally {
      spin.stop();
    }
  }

  // No zone given: only fall back to the picker when we can actually prompt.
  if (output === "json" || !process.stdout.isTTY) {
    throw new UserError(
      "A storage zone is required.",
      "Pass the zone name or ID.",
    );
  }

  const spin = spinner("Fetching storage zones...");
  spin.start();
  let zones: StorageZoneModel[];
  try {
    zones = await fetchStorageZones(client);
  } finally {
    spin.stop();
  }

  if (zones.length === 0) {
    throw new UserError(
      "No storage zones found.",
      'Create one with "bunny storage zones add <name>".',
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Storage zone:",
    choices: zones.map((zone) => ({ title: zone.Name ?? "", value: zone.Id })),
  });
  if (id === undefined) throw new UserError("A storage zone is required.");

  const loadSpin = spinner("Loading storage zone...");
  loadSpin.start();
  try {
    return await fetchStorageZone(client, id);
  } finally {
    loadSpin.stop();
  }
}
