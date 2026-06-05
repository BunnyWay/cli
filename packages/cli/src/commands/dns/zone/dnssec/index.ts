import { defineNamespace } from "../../../../core/define-namespace.ts";
import { dnsZoneDnssecDisableCommand } from "./disable.ts";
import { dnsZoneDnssecEnableCommand } from "./enable.ts";

export const dnsZoneDnssecNamespace = defineNamespace(
  "dnssec",
  "Manage DNSSEC for a zone.",
  [dnsZoneDnssecEnableCommand, dnsZoneDnssecDisableCommand],
);
