import type { StorageZoneModel } from "@/commands/storage/api.ts";
import { zoneTierLabel } from "@/commands/storage/constants.ts";
import { isS3Enabled, s3Endpoint } from "@/commands/storage/s3.ts";
import { formatBytes, formatDateTime } from "@/core/format.ts";

export function zoneDetailRows(
  zone: StorageZoneModel,
  opts?: { usage?: boolean },
): { key: string; value: string }[] {
  const rows = [
    { key: "ID", value: String(zone.Id ?? "") },
    { key: "Name", value: zone.Name ?? "" },
    { key: "Region", value: zone.Region ?? "-" },
    { key: "Tier", value: zoneTierLabel(zone, "long") },
    {
      key: "Replication",
      value: (zone.ReplicationRegions ?? []).join(", ") || "-",
    },
    { key: "Hostname", value: zone.StorageHostname ?? "-" },
  ];

  if (opts?.usage !== false) {
    rows.push(
      { key: "Files", value: String(zone.FilesStored ?? 0) },
      { key: "Used", value: formatBytes(zone.StorageUsed ?? 0) },
      { key: "Modified", value: formatDateTime(zone.DateModified) },
    );
  }

  rows.push({
    key: "S3 compatible",
    value: isS3Enabled(zone) ? "Enabled" : "Disabled",
  });
  if (isS3Enabled(zone)) {
    rows.push({ key: "S3 endpoint", value: s3Endpoint(zone) });
  }

  return rows;
}
