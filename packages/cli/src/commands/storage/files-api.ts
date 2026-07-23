// Edge Storage file access lives in @bunny.net/actions alongside the file actions.
// Re-exported here for existing call sites (sites/ uploads and deploy pruning).
export type {
  StorageFile,
  StorageFileEntry,
  StorageZoneConnection as StorageZone,
  UploadOptions,
} from "@bunny.net/actions";
export {
  connectStorageZone,
  deleteFile,
  downloadFile,
  listFiles,
  toStorageFileEntry,
  uploadFile,
} from "@bunny.net/actions";
