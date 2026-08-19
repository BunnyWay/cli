import { UserError } from "../../core/errors.ts";
import type { StorageZoneModel } from "./api.ts";
import { isS3Enabled, s3Credentials } from "./s3.ts";

export const CONNECTION_TYPES = ["ftp", "s3"] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const ENV_STORAGE_ZONE = "BUNNY_STORAGE_ZONE";
export const ENV_STORAGE_PASSWORD = "BUNNY_STORAGE_PASSWORD";
export const ENV_STORAGE_REGION = "BUNNY_STORAGE_REGION";

interface ConnectionField {
  key: string;
  name: string;
  value: string;
  secret?: boolean;
}

export interface StorageConnection {
  type: ConnectionType;
  label: string;
  fields: ConnectionField[];
  env: { key: string; value: string }[];
}

export function connectionLabel(type: ConnectionType): string {
  return type === "s3" ? "S3" : "FTP & HTTP API";
}

export function storageConnection(
  zone: StorageZoneModel,
  type: ConnectionType,
): StorageConnection {
  if (type === "s3") {
    const creds = s3Credentials(zone, false);
    return {
      type,
      label: connectionLabel(type),
      fields: [
        { key: "Endpoint", name: "endpoint", value: creds.endpoint },
        { key: "Region", name: "region", value: creds.region },
        { key: "Access Key ID", name: "accessKeyId", value: creds.accessKeyId },
        {
          key: "Secret Access Key",
          name: "secretAccessKey",
          value: creds.secretAccessKey,
          secret: true,
        },
      ],
      env: [
        { key: "AWS_ACCESS_KEY_ID", value: creds.accessKeyId },
        { key: "AWS_SECRET_ACCESS_KEY", value: creds.secretAccessKey },
        { key: "AWS_ENDPOINT_URL", value: creds.endpoint },
        { key: "AWS_REGION", value: creds.region },
      ],
    };
  }

  if (!zone.Name || !zone.Password) {
    throw new UserError(
      `No password available for storage zone ${zone.Name ?? "?"}.`,
      `Run "bunny storage zones credentials ${zone.Name ?? ""}" to fetch it.`,
    );
  }
  return {
    type,
    label: connectionLabel(type),
    fields: [
      {
        key: "Host",
        name: "host",
        value: zone.StorageHostname ?? "storage.bunnycdn.com",
      },
      { key: "Username", name: "username", value: zone.Name },
      {
        key: "Password",
        name: "password",
        value: zone.Password,
        secret: true,
      },
    ],
    env: [
      { key: ENV_STORAGE_ZONE, value: zone.Name },
      { key: ENV_STORAGE_PASSWORD, value: zone.Password },
      { key: ENV_STORAGE_REGION, value: zone.Region ?? "" },
    ],
  };
}

export function connectionRows(
  connection: StorageConnection,
): { key: string; value: string }[] {
  return connection.fields.map((field) => ({
    key: field.key,
    value: field.value,
  }));
}

export function connectionJson(
  connection: StorageConnection,
): Record<string, string> {
  return Object.fromEntries([
    ["type", connection.type],
    ...connection.fields.map((field) => [field.name, field.value]),
  ]);
}

export function hasSecret(connection: StorageConnection): boolean {
  return connection.fields.some((field) => field.secret);
}

export function connectionChoices(
  zone: StorageZoneModel,
): { title: string; description: string; value: ConnectionType }[] {
  const choices: {
    title: string;
    description: string;
    value: ConnectionType;
  }[] = [
    {
      title: connectionLabel("ftp"),
      description: "Host, username, and password",
      value: "ftp",
    },
  ];
  if (isS3Enabled(zone)) {
    choices.push({
      title: connectionLabel("s3"),
      description: "Endpoint, region, and access keys",
      value: "s3",
    });
  }
  return choices;
}
