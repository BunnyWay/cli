import { defineNamespace } from "../../../core/define-namespace.ts";
import { dnsZoneAddCommand } from "./add.ts";
import { dnsZoneDnssecNamespace } from "./dnssec/index.ts";
import { dnsZoneLoggingNamespace } from "./logging/index.ts";
import { dnsZoneRemoveCommand } from "./remove.ts";
import { dnsZoneShowCommand } from "./show.ts";

export const dnsZoneNamespace = defineNamespace("zone", "Manage DNS zones.", [
  dnsZoneAddCommand,
  dnsZoneShowCommand,
  dnsZoneRemoveCommand,
  dnsZoneDnssecNamespace,
  dnsZoneLoggingNamespace,
]);
