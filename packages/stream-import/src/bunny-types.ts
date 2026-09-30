/**
 * Bunny Stream shapes, aliased from the generated OpenAPI schemas.
 *
 * Aliasing rather than re-declaring keeps this honest against the spec; the one
 * thing kept hand-written is `BunnyVideoStatus`, because the generated form is
 * a bare numeric union and every comparison site reads better against a name.
 */

import type { components } from "@bunny.net/openapi-client/stream";

export type BunnyVideo = components["schemas"]["VideoModel"];
export type BunnyCollection = components["schemas"]["CollectionModel"];
export type BunnyMetaTag = components["schemas"]["MetaTagModel"];
export type BunnyStatusModel = components["schemas"]["StatusModel"];

/** Values 0-6 are the ones the encoder reports for a fetched video. */
export enum BunnyVideoStatus {
  Created = 0,
  Uploaded = 1,
  Processing = 2,
  Transcoding = 3,
  Finished = 4,
  Error = 5,
  UploadFailed = 6,
}

export function videoStatusText(status: number | undefined): string {
  switch (status) {
    case BunnyVideoStatus.Created:
      return "Created";
    case BunnyVideoStatus.Uploaded:
      return "Uploaded";
    case BunnyVideoStatus.Processing:
      return "Processing";
    case BunnyVideoStatus.Transcoding:
      return "Transcoding";
    case BunnyVideoStatus.Finished:
      return "Finished";
    case BunnyVideoStatus.Error:
      return "Error";
    case BunnyVideoStatus.UploadFailed:
      return "Upload Failed";
    default:
      return "Unknown";
  }
}
