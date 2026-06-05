import { defineNamespace } from "../../../core/define-namespace.ts";
import { dnsAddCommand } from "./add.ts";
import { dnsExportCommand } from "./export.ts";
import { dnsImportCommand } from "./import.ts";
import { dnsRecordListCommand } from "./list.ts";
import { dnsRemoveCommand } from "./remove.ts";
import { dnsUpdateCommand } from "./update.ts";

export const dnsRecordNamespace = defineNamespace(
  "record",
  "Manage the DNS records within a zone.",
  [
    dnsRecordListCommand,
    dnsAddCommand,
    dnsUpdateCommand,
    dnsRemoveCommand,
    dnsImportCommand,
    dnsExportCommand,
  ],
  ["records", "rec"],
);
