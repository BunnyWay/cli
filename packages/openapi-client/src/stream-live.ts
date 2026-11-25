/**
 * Stream Live entrypoint: generated types for the live stream endpoints.
 *
 * They come from the preview Stream API spec (`specs/stream-live.json`) until
 * Live reaches the public one; `createStreamClient` already accepts them.
 */

export type * from "./generated/stream-live.d.ts";
export { createStreamClient } from "./stream-client.ts";
