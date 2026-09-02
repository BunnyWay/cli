import { defineNamespace } from "@/core/define-namespace.ts";
import { dnsAddCommand } from "./add.ts";
import { dnsExportCommand } from "./export.ts";
import { dnsImportCommand } from "./import.ts";
import { dnsRecordListCommand } from "./list.ts";
import { dnsPresetCommand } from "./preset.ts";
import { dnsRemoveCommand } from "./remove.ts";
import { dnsScanCommand } from "./scan.ts";
import { dnsUpdateCommand } from "./update.ts";

export const dnsRecordNamespace = defineNamespace(
  "records",
  "Manage the DNS records within a zone.",
  [
    dnsRecordListCommand,
    dnsAddCommand,
    dnsUpdateCommand,
    dnsRemoveCommand,
    dnsPresetCommand,
    dnsScanCommand,
    dnsImportCommand,
    dnsExportCommand,
  ],
  ["record", "rec"],
);
