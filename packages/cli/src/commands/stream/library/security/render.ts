import type { SecuritySettings } from "@bunny.net/tools/stream";
import { formatKeyValue, maskSecret } from "@/core/format.ts";
import type { OutputFormat } from "@/core/types.ts";

function onOff(value: boolean | null): string {
  if (value === null) return "Unknown (no linked Pull Zone)";
  return value ? "On" : "Off";
}

const DRM_LABELS = {
  basic: "MediaCage Basic",
  basicV2: "MediaCage Basic (v2)",
  enterprise: "MediaCage Enterprise",
} as const;

export function formatSecuritySettings(
  security: SecuritySettings,
  output: OutputFormat,
  tokenKey?: { key: string; reveal: boolean },
): string {
  const rows = [
    { key: "Library ID", value: String(security.library) },
    { key: "Direct play", value: onOff(security.directPlay) },
    {
      key: "Allowed domains",
      value: security.allowedDomains.join(", ") || "All (no list)",
    },
    {
      key: "Blocked domains",
      value: security.blockedDomains.join(", ") || "None",
    },
    {
      key: "Block direct url access",
      value: onOff(security.blockDirectAccess),
    },
    { key: "Embed view token auth", value: onOff(security.embedToken) },
    { key: "CDN token auth", value: onOff(security.cdnToken) },
    { key: "Token IP binding", value: onOff(security.tokenIp) },
    {
      key: "DRM",
      value: security.drm.enabled
        ? security.drm.version
          ? DRM_LABELS[security.drm.version]
          : "On"
        : "Off",
    },
  ];
  if (tokenKey) {
    rows.push({
      key: "Token authentication key",
      value: tokenKey.reveal ? tokenKey.key : maskSecret(tokenKey.key),
    });
  }
  return formatKeyValue(rows, output);
}
