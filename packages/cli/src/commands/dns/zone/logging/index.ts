import { defineNamespace } from "@/core/define-namespace.ts";
import { dnsZoneLoggingDisableCommand } from "./disable.ts";
import { dnsZoneLoggingEnableCommand } from "./enable.ts";

export const dnsZoneLoggingNamespace = defineNamespace(
  "logging",
  "Manage DNS query logging for a zone.",
  [dnsZoneLoggingEnableCommand, dnsZoneLoggingDisableCommand],
);
