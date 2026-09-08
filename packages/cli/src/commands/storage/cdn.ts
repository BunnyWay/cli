import { systemHostname } from "@/core/hostnames/index.ts";
import type { StorageZoneModel } from "./api.ts";

/** The public URL of the pull zone in front of a storage zone, when it has one. */
export function storageCdnUrl(zone: StorageZoneModel): string | undefined {
  for (const pullZone of zone.PullZones ?? []) {
    const host = systemHostname(pullZone.Hostnames);
    if (host) return `https://${host}`;
  }
  return undefined;
}
