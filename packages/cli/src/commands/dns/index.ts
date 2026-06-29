import { defineNamespace } from "../../core/define-namespace.ts";
import { dnsRecordNamespace } from "./record/index.ts";
import { dnsScriptsNamespace } from "./scripts/index.ts";
import { dnsZoneHiddenAliases, dnsZoneNamespace } from "./zone/index.ts";

// Hidden from help while experimental, matching the apps and registries namespaces.
export const dnsNamespace = defineNamespace("dns", false, [
  dnsRecordNamespace,
  dnsZoneNamespace,
  dnsScriptsNamespace,
  ...dnsZoneHiddenAliases,
]);
