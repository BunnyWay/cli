import { defineNamespace } from "../../core/define-namespace.ts";
import { dnsRecordNamespace } from "./record/index.ts";
import { dnsZoneHiddenAliases, dnsZoneNamespace } from "./zone/index.ts";

export const dnsNamespace = defineNamespace(
  "dns",
  "Manage DNS zones and records.",
  [dnsRecordNamespace, dnsZoneNamespace, ...dnsZoneHiddenAliases],
);
