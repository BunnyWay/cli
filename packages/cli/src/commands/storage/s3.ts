import { UserError } from "../../core/errors.ts";
import type { StorageZoneModel } from "./api.ts";

export interface S3Credentials {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Config formats for external S3 tools (default human/json output is handled by --output).
export const S3_TOOL_FORMATS = ["rclone", "aws", "s3cmd", "env"] as const;
export type S3ToolFormat = (typeof S3_TOOL_FORMATS)[number];

export function isS3Enabled(zone: StorageZoneModel): boolean {
  return zone.StorageZoneType === 1;
}

// Edge Storage S3 endpoint, e.g. https://de-s3.storage.bunnycdn.com
export function s3Endpoint(zone: StorageZoneModel): string {
  return `https://${(zone.Region ?? "").toLowerCase()}-s3.storage.bunnycdn.com`;
}

export function s3Credentials(
  zone: StorageZoneModel,
  readOnly: boolean,
): S3Credentials {
  const secret = readOnly ? zone.ReadOnlyPassword : zone.Password;
  if (!zone.Name || !secret) {
    throw new UserError(
      `No ${readOnly ? "read-only " : ""}password available for storage zone ${zone.Name ?? "?"}.`,
    );
  }
  return {
    endpoint: s3Endpoint(zone),
    region: (zone.Region ?? "").toLowerCase(),
    accessKeyId: zone.Name,
    secretAccessKey: secret,
  };
}

// Single-quote a value for safe shell `eval`: wrap in '...' and escape any embedded quote.
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const TOOL_FORMATTERS: Record<
  S3ToolFormat,
  (creds: S3Credentials, zoneName: string) => string
> = {
  // env output is meant for `eval`, so every value must be shell-quoted.
  env: (c) =>
    [
      `AWS_ACCESS_KEY_ID=${shSingleQuote(c.accessKeyId)}`,
      `AWS_SECRET_ACCESS_KEY=${shSingleQuote(c.secretAccessKey)}`,
      `AWS_ENDPOINT_URL=${shSingleQuote(c.endpoint)}`,
      `AWS_REGION=${shSingleQuote(c.region)}`,
    ].join("\n"),

  rclone: (c, zoneName) =>
    [
      `[${zoneName}]`,
      "type = s3",
      "provider = Other",
      `access_key_id = ${c.accessKeyId}`,
      `secret_access_key = ${c.secretAccessKey}`,
      `endpoint = ${c.endpoint}`,
      `region = ${c.region}`,
    ].join("\n"),

  aws: (c, zoneName) =>
    [
      `[${zoneName}]`,
      `aws_access_key_id = ${c.accessKeyId}`,
      `aws_secret_access_key = ${c.secretAccessKey}`,
      `region = ${c.region}`,
      `endpoint_url = ${c.endpoint}`,
    ].join("\n"),

  s3cmd: (c) => {
    const host = c.endpoint.replace(/^https?:\/\//, "");
    return [
      "[default]",
      `access_key = ${c.accessKeyId}`,
      `secret_key = ${c.secretAccessKey}`,
      `host_base = ${host}`,
      `host_bucket = ${host}`,
      "use_https = True",
    ].join("\n");
  },
};

export function renderS3ToolConfig(
  format: S3ToolFormat,
  creds: S3Credentials,
  zoneName: string,
): string {
  return TOOL_FORMATTERS[format](creds, zoneName);
}
