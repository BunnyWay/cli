import { defineNamespace } from "../../core/define-namespace.ts";
import { dnsAddCommand } from "./add.ts";
import { dnsExportCommand } from "./export.ts";
import { dnsImportCommand } from "./import.ts";
import { dnsListCommand } from "./list.ts";
import { dnsNameserversCommand } from "./nameservers.ts";
import { dnsRemoveCommand } from "./remove.ts";
import { dnsStatsCommand } from "./stats.ts";
import { dnsUpdateCommand } from "./update.ts";
import { dnsZoneNamespace } from "./zone/index.ts";

export const dnsNamespace = defineNamespace(
  "dns",
  "Manage DNS zones and records.",
  [
    dnsListCommand,
    dnsAddCommand,
    dnsUpdateCommand,
    dnsRemoveCommand,
    dnsImportCommand,
    dnsExportCommand,
    dnsStatsCommand,
    dnsNameserversCommand,
    dnsZoneNamespace,
  ],
);
