import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceVideo,
} from "@bunny.net/stream-import";
import type { S3SourceClient } from "./client.ts";
import { extractVideoNameFromKey, fromSourceId, toSourceId } from "./keys.ts";
import type { S3Config, S3Object } from "./types.ts";
import { validateS3Url } from "./validate.ts";

export class S3SourceAdapter implements SourceAdapter {
  readonly id = "s3";
  readonly dedupTag = "s3Source";

  private readonly bucket: string;
  private readonly prefix: string;
  private readonly urlTtlSeconds?: number;

  constructor(
    private readonly client: S3SourceClient,
    config: S3Config,
  ) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? "";
    this.urlTtlSeconds = config.presignedUrlTtl;
  }

  validateCredentials(): Promise<void> {
    return this.client.validateCredentials(this.bucket);
  }

  getAccountInfo(): Promise<Record<string, string>> {
    return this.client.getAccountInfo(this.bucket, this.prefix);
  }

  validateUrl(url: string): boolean {
    return validateS3Url(url);
  }

  async listContent(opts?: { folderId?: string }): Promise<SourceContent> {
    const result = await this.client.getAllVideosWithFolders(
      this.bucket,
      this.prefix,
    );

    const toVideo = (obj: S3Object, folderId: string | null): SourceVideo => ({
      sourceId: toSourceId(obj.bucket, obj.key),
      displayName: extractVideoNameFromKey(obj.key),
      folderId,
      size: obj.size,
      // S3 knows nothing about media duration.
      duration: undefined,
    });

    if (opts?.folderId) {
      const folderId = opts.folderId;
      const folder = result.folders.find((f) => f.id === folderId);
      const objects = result.videos.get(folderId) ?? [];

      return {
        folders: folder
          ? [{ id: folder.id, name: folder.name, videoCount: objects.length }]
          : [],
        videos: new Map([[folderId, objects.map((o) => toVideo(o, folderId))]]),
        uncategorizedVideos: [],
      };
    }

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

  async getDownloadInfo(sourceId: string): Promise<DownloadInfo | null> {
    const { bucket, key } = fromSourceId(sourceId);
    if (!key) return null;

    const url = await this.client.getPresignedDownloadUrl(
      bucket,
      key,
      this.urlTtlSeconds,
    );

    // Metadata is a bonus: a bucket that denies HeadObject should still import.
    const head = await this.client.headObject(bucket, key).catch(() => null);
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
