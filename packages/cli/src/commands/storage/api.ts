// Storage zone API access lives in @bunny.net/actions so the CLI and any other host
// agents all read zones the same way. Re-exported here for existing call sites.
export type {
  CoreClient,
  SafeStorageZone,
  StorageZoneModel,
  StorageZoneSettingsModel,
} from "@bunny.net/actions";
export {
  fetchStorageZone,
  fetchStorageZones,
  resolveStorageZone,
  toSafeStorageZone,
} from "@bunny.net/actions";
