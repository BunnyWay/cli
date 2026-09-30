import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceVideo,
} from "@bunny.net/stream-import";
import { archivedReason, type S3SourceClient } from "./client.ts";
import {
  extractVideoNameFromKey,
  fromSourceId,
  idToPrefix,
  toSourceId,
} from "./keys.ts";
import type { S3Config, S3Object } from "./types.ts";
import { validateS3Url } from "./validate.ts";

export class S3SourceAdapter implements SourceAdapter {
  readonly id = "s3";
  readonly dedupTag = "s3Source";

  private readonly bucket: string;
  private readonly prefix: string;
  private readonly urlTtlSeconds?: number;
  private readonly endpoint?: string;

  constructor(
    private readonly client: S3SourceClient,
    config: S3Config,
  ) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? "";
    this.urlTtlSeconds = config.presignedUrlTtl;
    this.endpoint = config.endpoint;
  }

  validateCredentials(): Promise<void> {
    return this.client.validateCredentials(this.bucket);
  }

  getAccountInfo(): Promise<Record<string, string>> {
    return this.client.getAccountInfo(this.bucket, this.prefix);
  }

  validateUrl(url: string): boolean {
    return validateS3Url(url, this.endpoint);
  }

  async listContent(opts?: { folderId?: string }): Promise<SourceContent> {
    const toVideo = (obj: S3Object, folderId: string | null): SourceVideo => ({
      sourceId: toSourceId(obj.bucket, obj.key),
      displayName: extractVideoNameFromKey(obj.key),
      folderId,
      size: obj.size,
      // S3 knows nothing about media duration.
      duration: undefined,
    });

    // A nested id like `a/b` lists just that subtree but lands in collection `a`, where full discovery puts it.
    if (opts?.folderId) {
      const folderId = opts.folderId;
      const objects = await this.client.listVideosByPrefix(
        this.bucket,
        idToPrefix(folderId, this.prefix),
      );
      const name = folderId.split("/")[0] || folderId;

      return {
        folders: objects.length
          ? [{ id: folderId, name, videoCount: objects.length }]
          : [],
        videos: new Map([[folderId, objects.map((o) => toVideo(o, folderId))]]),
        uncategorizedVideos: [],
      };
    }

    const result = await this.client.getAllVideosWithFolders(
      this.bucket,
      this.prefix,
    );
    const videos = new Map<string, SourceVideo[]>();
    for (const [folderId, objects] of result.videos) {
      videos.set(
        folderId,
        objects.map((o) => toVideo(o, folderId)),
      );
    }

    return {
      folders: result.folders.map((f) => ({
        id: f.id,
        name: f.name,
        videoCount: f.videoCount,
      })),
      videos,
      uncategorizedVideos: result.uncategorizedVideos.map((o) =>
        toVideo(o, null),
      ),
    };
  }

  async getDownloadInfo(
    sourceId: string,
    signal?: AbortSignal,
  ): Promise<DownloadInfo | null> {
    const { bucket, key } = fromSourceId(sourceId);
    if (!key) return null;

    // Metadata is a bonus: a bucket that denies HeadObject should still import.
    const head = await this.client
      .headObject(bucket, key, signal)
      .catch(() => null);
    signal?.throwIfAborted();
    const archived = head && archivedReason(head);
    if (archived) throw new Error(archived);

    const url = await this.client.getPresignedDownloadUrl(
      bucket,
      key,
      this.urlTtlSeconds,
    );
    const description = head?.userMetadata?.description;
    const tags = head?.userMetadata?.tags
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    return {
      url,
      title: extractVideoNameFromKey(key),
      description,
      tags: tags?.length ? tags : undefined,
    };
  }
}
