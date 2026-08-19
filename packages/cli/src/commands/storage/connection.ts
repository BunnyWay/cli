import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import { formatKeyValue, maskSecret } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import type { OutputFormat } from "../../core/types.ts";
import { confirm } from "../../core/ui.ts";
import { readEnvValue, writeEnvValue } from "../../utils/env-file.ts";
import { DOCS_BASE_URL } from "../docs.ts";
import type { StorageZoneModel } from "./api.ts";
import { sdkRegionKey } from "./constants.ts";
import {
  isS3Enabled,
  renderS3ToolConfig,
  S3_TOOL_FORMATS,
  s3Credentials,
} from "./s3.ts";


export const CONNECTION_TYPES = ["http", "ftp", "s3"] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const ENV_STORAGE_ZONE = "BUNNY_STORAGE_ZONE";
export const ENV_STORAGE_PASSWORD = "BUNNY_STORAGE_PASSWORD";
export const ENV_STORAGE_REGION = "BUNNY_STORAGE_REGION";

const META: Record<
  ConnectionType,
  { label: string; summary: string; docs: string }
> = {
  http: {
    label: "HTTP API",
    summary: "Base URL and AccessKey header",
    docs: `${DOCS_BASE_URL}/storage/http`,
  },
  ftp: {
    label: "FTP",
    summary: "Host, username, password",
    docs: `${DOCS_BASE_URL}/storage/ftp`,
  },
  s3: {
    label: "S3",
    summary: "Endpoint, region, access keys",
    docs: `${DOCS_BASE_URL}/storage/s3`,
  },
};

interface ConnectionField {
  key: string;
  name: string;
  value: string;
  secret?: boolean;
}

export interface StorageConnection {
  type: ConnectionType;
  label: string;
  docs: string;
  fields: ConnectionField[];
  env: { key: string; value: string }[];
}

export function connectionLabel(type: ConnectionType): string {
  return META[type].label;
}

function zoneCredentials(
  zone: StorageZoneModel,
  readOnly: boolean,
): { name: string; password: string; host: string } {
  const password = readOnly ? zone.ReadOnlyPassword : zone.Password;
  if (!zone.Name || !password) {
    throw new UserError(
      `No ${readOnly ? "read-only " : ""}password available for storage zone ${zone.Name ?? "?"}.`,
      `Run "bunny storage zones credentials ${zone.Name ?? ""}" to fetch it.`,
    );
  }
  return {
    name: zone.Name,
    password,
    host: zone.StorageHostname ?? "storage.bunnycdn.com",
  };
}

export function storageConnection(
  zone: StorageZoneModel,
  type: ConnectionType,
  opts?: { readOnly?: boolean },
): StorageConnection {
  const { label, docs } = META[type];
  const readOnly = opts?.readOnly ?? false;

  if (type === "s3") {
    const creds = s3Credentials(zone, readOnly);
    return {
      type,
      label,
      docs,
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

  const { name, password, host } = zoneCredentials(zone, readOnly);
  const env = [
    { key: ENV_STORAGE_ZONE, value: name },
    { key: ENV_STORAGE_PASSWORD, value: password },
    { key: ENV_STORAGE_REGION, value: zone.Region ?? "" },
  ];

  // The HTTP API takes the password as an AccessKey header against a per-zone base URL.
  if (type === "http") {
    return {
      type,
      label,
      docs,
      fields: [
        { key: "Base URL", name: "baseUrl", value: `https://${host}/${name}/` },
        {
          key: "AccessKey",
          name: "accessKey",
          value: password,
          secret: true,
        },
      ],
      env,
    };
  }

  return {
    type,
    label,
    docs,
    fields: [
      { key: "Host", name: "host", value: host },
      { key: "Username", name: "username", value: name },
      { key: "Password", name: "password", value: password, secret: true },
    ],
    env,
  };
}

function render(field: ConnectionField, mask: boolean): string {
  return field.secret && mask ? maskSecret(field.value) : field.value;
}

export function connectionRows(
  connection: StorageConnection,
  opts?: { mask?: boolean },
): { key: string; value: string }[] {
  return connection.fields.map((field) => ({
    key: field.key,
    value: render(field, opts?.mask ?? false),
  }));
}

export function connectionJson(
  connection: StorageConnection,
  opts?: { mask?: boolean },
): Record<string, string> {
  return Object.fromEntries([
    ["type", connection.type],
    ...connection.fields.map((field) => [
      field.name,
      render(field, opts?.mask ?? false),
    ]),
  ]);
}

export function hasSecret(connection: StorageConnection): boolean {
  return connection.fields.some((field) => field.secret);
}

export function connectionChoices(
  zone: StorageZoneModel,
): { title: string; description: string; value: ConnectionType }[] {
  const types: ConnectionType[] = isS3Enabled(zone)
    ? ["http", "ftp", "s3"]
    : ["http", "ftp"];
  return types.map((type) => ({
    title: META[type].label,
    description: META[type].summary,
    value: type,
  }));
}

// Ready-to-paste output per client. The JS SDK talks to the HTTP API, the rest are S3 tools.
export const CLIENT_FORMATS = [...S3_TOOL_FORMATS, "sdk"] as const;
export type ClientFormat = (typeof CLIENT_FORMATS)[number];

const CLIENTS: Record<
  ConnectionType,
  { title: string; value: ClientFormat }[]
> = {
  http: [{ title: "JavaScript SDK (@bunny.net/storage-sdk)", value: "sdk" }],
  ftp: [],
  s3: [
    { title: "rclone", value: "rclone" },
    { title: "AWS CLI", value: "aws" },
    { title: "s3cmd", value: "s3cmd" },
    { title: "Environment variables", value: "env" },
  ],
};

export function clientType(format: ClientFormat): ConnectionType {
  return format === "sdk" ? "http" : "s3";
}

/** The SDK needs the zone name, the access key, and a region enum member. */
function renderStorageSdk(zone: StorageZoneModel): string {
  const key = sdkRegionKey(zone.Region);
  const region = key
    ? `BunnyStorageSDK.regions.StorageRegion.${key}`
    : JSON.stringify((zone.Region ?? "").toLowerCase());
  return [
    'import * as BunnyStorageSDK from "@bunny.net/storage-sdk";',
    "",
    `const region = ${region};`,
    `const sz = BunnyStorageSDK.zone.connect_with_accesskey(`,
    `  region,`,
    `  process.env.${ENV_STORAGE_ZONE},`,
    `  process.env.${ENV_STORAGE_PASSWORD},`,
    `);`,
    "",
    'const files = await BunnyStorageSDK.file.list(sz, "/");',
  ].join("\n");
}

function renderClient(
  zone: StorageZoneModel,
  format: ClientFormat,
  readOnly: boolean,
): string {
  if (format === "sdk") return renderStorageSdk(zone);
  return renderS3ToolConfig(
    format,
    s3Credentials(zone, readOnly),
    zone.Name as string,
  );
}

export async function promptConnectionType(
  zone: StorageZoneModel,
): Promise<ConnectionType | undefined> {
  const { picked } = await prompts({
    type: "select",
    name: "picked",
    message: "Connect using:",
    choices: connectionChoices(zone),
  });
  return picked;
}

// "other" keeps the list from trapping anyone whose tool is not on it.
export async function promptClient(
  type: ConnectionType,
): Promise<ClientFormat | undefined> {
  const clients = CLIENTS[type];
  if (clients.length === 0) return undefined;
  const { picked } = await prompts({
    type: "select",
    name: "picked",
    message: "Which client?",
    choices: [
      ...clients,
      { title: "Other (just show the credentials)", value: "other" },
    ],
  });
  return picked === "other" ? undefined : picked;
}

/** Print a connection as a tool config when a client was chosen, else as a credential table. */
export function printConnection(
  zone: StorageZoneModel,
  connection: StorageConnection,
  opts: {
    output: OutputFormat;
    mask?: boolean;
    format?: ClientFormat;
    readOnly?: boolean;
  },
): void {
  if (opts.format) {
    logger.log(renderClient(zone, opts.format, opts.readOnly ?? false));
    logger.dim(`Docs: ${connection.docs}`);
    return;
  }

  logger.log();
  logger.log(`${connection.label} connection`);
  logger.log(formatKeyValue(connectionRows(connection, opts), opts.output));
  if (opts.mask) {
    logger.dim("Secret masked. Pass --show-secret to reveal it.");
  } else if (hasSecret(connection)) {
    logger.warn("Treat these credentials like a password.");
  }
  logger.dim(`Docs: ${connection.docs}`);
}

function writeConnectionEnv(connection: StorageConnection): void {
  const envPath = connection.env
    .map(({ key }) => readEnvValue(key)?.envPath)
    .find(Boolean);
  for (const { key, value } of connection.env) {
    writeEnvValue(key, value, envPath);
  }
}

/** Offer to write the connection's variables to .env. Writing is always confirmed or flagged. */
export async function offerConnectionEnv(
  connection: StorageConnection,
  opts: { saveEnv?: boolean; interactive: boolean },
): Promise<boolean> {
  let save = opts.saveEnv;
  if (save === undefined && opts.interactive) {
    const clash = connection.env.find(({ key }) => readEnvValue(key));
    // Default to yes for a fresh write, but never for one that clobbers an existing value.
    save = await confirm(
      clash
        ? `${clash.key} already exists in ${readEnvValue(clash.key)?.envPath}. Overwrite?`
        : "Save these credentials to .env?",
      { initial: !clash },
    );
  }
  if (!save) return false;

  writeConnectionEnv(connection);
  logger.success(
    `Saved ${connection.env.map(({ key }) => key).join(", ")} to .env`,
  );
  return true;
}
