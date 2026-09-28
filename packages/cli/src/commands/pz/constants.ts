import { UserError } from "@/core/errors.ts";
import { loadManifest } from "@/core/manifest.ts";

export const PULL_ZONE_MANIFEST = "pullzone.json";

export interface PullZoneManifest {
  id: number;
  name?: string;
}

/** The explicit ID, else the one this directory is linked to. */
export function resolvePullZoneId(id: number | undefined): number {
  const resolved = id ?? loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST).id;
  if (!resolved) {
    throw new UserError(
      "No pull zone specified.",
      'Pass a pull zone ID or run "bunny pz link" first.',
    );
  }
  return resolved;
}
