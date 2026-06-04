import type { CommandModule } from "yargs";
import { defineNamespace } from "../../../core/define-namespace.ts";
import { dnsZoneAddCommand } from "./add.ts";
import { dnsZoneDnssecNamespace } from "./dnssec/index.ts";
import { dnsZoneListCommand } from "./list.ts";
import { dnsZoneLoggingNamespace } from "./logging/index.ts";
import { dnsNameserversCommand } from "./nameservers.ts";
import { dnsZoneRemoveCommand } from "./remove.ts";
import { dnsZoneShowCommand } from "./show.ts";
import { dnsStatsCommand } from "./stats.ts";

const subcommands: CommandModule[] = [
  dnsZoneListCommand,
  dnsZoneAddCommand,
  dnsZoneShowCommand,
  dnsZoneRemoveCommand,
  dnsStatsCommand,
  dnsNameserversCommand,
  dnsZoneDnssecNamespace,
  dnsZoneLoggingNamespace,
];

export const dnsZoneNamespace = defineNamespace(
  "zone",
  "Manage DNS zones — settings, DNSSEC, logging, stats, nameservers.",
  subcommands,
  ["zones"],
);

// Hidden aliases so `bunny dns domain …` works without cluttering help.
export const dnsZoneHiddenAliases: CommandModule[] = ["domain", "domains"].map(
  (name) => defineNamespace(name, false, subcommands),
);
