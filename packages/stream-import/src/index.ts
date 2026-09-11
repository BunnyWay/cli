// Re-exported so adapter packages depend on this package alone.
export { ApiError, UserError } from "@bunny.net/openapi-client";
export type {
  BunnyStreamOptions,
  FetchVideoResult,
  ProcessingResult,
  StreamClient,
} from "./bunny-stream.ts";
export { BunnyStream } from "./bunny-stream.ts";
export type {
  BunnyCollection,
  BunnyMetaTag,
  BunnyStatusModel,
  BunnyVideo,
} from "./bunny-types.ts";
export { BunnyVideoStatus, videoStatusText } from "./bunny-types.ts";
export * from "./constants.ts";
export type * from "./contracts.ts";
export type {
  Env,
  ResolveSourceConfigOptions,
  SourceConfigValues,
  SourceReadiness,
  SourceStatus,
} from "./credentials.ts";
export {
  coerceCredential,
  describeSource,
  missingCredentials,
  parseSourceConfig,
  resolveSourceConfig,
} from "./credentials.ts";
export type { Http, HttpOptions, Query, RequestOptions } from "./http.ts";
export { createHttp, HttpError, isHttpError } from "./http.ts";
export type {
  MigrationOptions,
  MigrationServiceOptions,
  MigrationSummary,
  SummaryVideo,
} from "./migration.ts";
export { MigrationService, runPool } from "./migration.ts";
export {
  isHttpsUrl,
  isValidBunnyGuid,
  safeErrorMessage,
  sanitizeMetadata,
  sanitizeString,
  stripAnsi,
  trimTrailingSlashes,
} from "./sanitize.ts";
export { buildSourceIndex } from "./source-index.ts";
export { assertFolderSupported } from "./source-plugin.ts";
export type { FileStateStoreOptions } from "./state.ts";
export {
  createFileStateStore,
  getMigrationStateErrors,
  migrationStateSchema,
  readMigrationState,
  validateMigrationState,
} from "./state.ts";
