import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, saveManifest } from "../../core/manifest.ts";
import type { OutputFormat } from "../../core/types.ts";
import { confirm, isInteractive, prompts, spinner } from "../../core/ui.ts";
import {
  type CoreClient,
  fetchStorageZone,
  fetchStorageZones,
  resolveStorageZone,
  type StorageZoneModel,
} from "./api.ts";
import { STORAGE_MANIFEST, type StorageZoneManifest } from "./constants.ts";

/** Write `.bunny/storage.json` pointing at the zone. */
export function writeStorageManifest(zone: StorageZoneModel): void {
  saveManifest<StorageZoneManifest>(STORAGE_MANIFEST, {
    id: zone.Id ?? 0,
    name: zone.Name ?? undefined,
  });
}

// Offer to remember a zone picked from the prompt; a no-op if the user declines.
async function maybeLinkZone(zone: StorageZoneModel): Promise<void> {
  if (
    !(await confirm(`Link this directory to ${zone.Name}?`, { optional: true }))
  )
    return;
  writeStorageManifest(zone);
  logger.success(`Linked this directory to storage zone ${zone.Name}.`);
}

/**
 * Resolve a zone by name/ID, or prompt the user to pick one when no
 * reference is given. Manages its own spinner so it never spins over a prompt.
 *
 * When `offerLink` is set and the zone is chosen via the picker (not an
 * explicit ref or the existing manifest), offer to link the directory to it.
 * Pass `ignoreManifest` to always pick (used when (re)linking a directory).
 * Never prompts non-interactively (json output, no TTY, or `force`): errors instead.
 */
export async function resolveStorageZoneInteractive(
  client: CoreClient,
  ref: string | undefined,
  opts: {
    output?: OutputFormat;
    force?: boolean;
    offerLink?: boolean;
    ignoreManifest?: boolean;
  } = {},
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

  // A zone linked via `bunny storage link` stands in for an explicit ref, even unattended.
  if (!opts.ignoreManifest) {
    const manifest = loadManifest<StorageZoneManifest>(STORAGE_MANIFEST);
    if (manifest.id) {
      const spin = spinner("Loading linked storage zone...");
      spin.start();
      try {
        return await fetchStorageZone(client, manifest.id);
      } finally {
        spin.stop();
      }
    }
  }

  // No zone given: only fall back to the picker when we can actually prompt (--force opts out too).
  if (opts.force || !isInteractive(opts.output)) {
    throw new UserError(
      "A storage zone is required.",
      "Pass the zone name or ID, or link one with `bunny storage link`.",
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
  let zone: StorageZoneModel;
  try {
    zone = await fetchStorageZone(client, id);
  } finally {
    loadSpin.stop();
  }

  // The picker only runs interactively, so the link offer can't taint machine output.
  if (opts.offerLink) {
    await maybeLinkZone(zone);
  }
  return zone;
}
