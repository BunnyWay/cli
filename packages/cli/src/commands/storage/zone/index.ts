import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { storageZoneCreateCommand } from "./create.ts";
import { storageZoneCredentialsCommand } from "./credentials.ts";
import { storageZoneDeleteCommand } from "./delete.ts";
import { storageZoneHostnamesCommands } from "./hostnames/index.ts";
import { storageZoneListCommand } from "./list.ts";
import { storageZoneShowCommand } from "./show.ts";
import { storageZoneUpdateCommand } from "./update.ts";

const subcommands: CommandModule[] = [
  storageZoneListCommand,
  storageZoneCreateCommand,
  storageZoneShowCommand,
  storageZoneUpdateCommand,
  storageZoneDeleteCommand,
  storageZoneCredentialsCommand,
  ...storageZoneHostnamesCommands,
];

export const storageZoneNamespace = defineNamespace(
  "zones",
  "Manage storage zones: create, list, inspect, delete.",
  subcommands,
  ["zone"],
);

// Hidden aliases so `bunny storage bucket …` works for S3/R2 muscle memory.
export const storageZoneHiddenAliases: CommandModule[] = [
  "bucket",
  "buckets",
].map((name) => defineNamespace(name, false, subcommands));
