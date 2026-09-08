import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceVideo,
} from "@bunny.net/stream-import";
import type { CloudflareStreamClient } from "./client.ts";
import type { CfStreamVideo } from "./types.ts";

/** Cloudflare Stream has no folder concept; every video is uncategorized. */
export class CloudflareStreamAdapter implements SourceAdapter {
  readonly id = "cloudflare";
  readonly dedupTag = "cfStreamId";

  constructor(private readonly client: CloudflareStreamClient) {}

  validateCredentials(): Promise<void> {
    return this.client.validateCredentials();
  }

  getAccountInfo(): Promise<Record<string, string>> {
    return this.client.getAccountInfo();
  }

  async listContent(): Promise<SourceContent> {
    const videos = await this.client.listVideos();

    return {
      folders: [],
      videos: new Map(),
      uncategorizedVideos: videos.map(toSourceVideo),
    };
  }

  async getDownloadInfo(
    sourceId: string,
    fallbackTitle?: string,
  ): Promise<DownloadInfo | null> {
    const download = await this.client.getDownloadUrl(sourceId);
    if (!download) return null;

    const video = await this.client.getVideo(sourceId);

    return {
      url: download.url,
      title: video.meta?.name || fallbackTitle || sourceId,
      description: video.meta?.description || undefined,
    };
  }
}

function toSourceVideo(video: CfStreamVideo): SourceVideo {
  return {
    sourceId: video.uid,
    displayName: video.meta?.name || video.uid,
    folderId: null,
    size: video.size || undefined,
    duration: video.duration || undefined,
  };
}
