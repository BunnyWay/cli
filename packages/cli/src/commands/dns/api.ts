// DNS domain logic lives in @bunny.net/actions; this shim keeps CLI-local import paths stable.
export type {
  AddDnsRecordModel,
  CoreClient,
  DnsDiscoveredRecord,
  DnsRecordModel,
  DnsZoneModel,
} from "@bunny.net/actions";
export {
  discoverImportableRecords,
  fetchZone,
  fetchZones,
  resolveZone,
  scanZoneRecords,
  writeRecords,
} from "@bunny.net/actions";
