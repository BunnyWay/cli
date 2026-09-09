import { systemHostname } from "@/core/hostnames/index.ts";
import type { StorageZoneModel } from "./api.ts";

export function storageCdnUrls(zone: StorageZoneModel): string[] {
  const urls: string[] = [];
  for (const pullZone of zone.PullZones ?? []) {
    const host = systemHostname(pullZone.Hostnames);
    if (host) urls.push(`https://${host}`);
  }
  return urls;
}

// Several pull zones can share a storage origin; picking one would put an arbitrary host in .env.
export function storageCdnUrl(zone: StorageZoneModel): string | undefined {
  const urls = storageCdnUrls(zone);
  return urls.length === 1 ? urls[0] : undefined;
}
