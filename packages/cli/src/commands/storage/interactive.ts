import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
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
