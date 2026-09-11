import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceVideo,
} from "@bunny.net/stream-import";
import type { JWPlayerClient } from "./client.ts";
import type { JWMedia } from "./types.ts";

/** JW Player has no folder concept; every media item is uncategorized. */
export class JWPlayerAdapter implements SourceAdapter {
  readonly id = "jwplayer";
  readonly dedupTag = "jwPlayerId";

  constructor(private readonly client: JWPlayerClient) {}

  validateCredentials(): Promise<void> {
    return this.client.validateCredentials();
  }

  getAccountInfo(): Promise<Record<string, string>> {
    return this.client.getAccountInfo();
  }

  async listContent(): Promise<SourceContent> {
    const media = await this.client.listMedia();

    return {
      folders: [],
      videos: new Map(),
      uncategorizedVideos: media.map(toSourceVideo),
    };
  }

  async getDownloadInfo(
    sourceId: string,
    fallbackTitle?: string,
  ): Promise<DownloadInfo | null> {
    const media = await this.client.getMedia(sourceId);
    const download = await this.client.getDownloadUrl(media);
    if (!download) return null;

    return {
      url: download.url,
      title: media.metadata.title || fallbackTitle || sourceId,
      description: media.metadata.description || undefined,
      tags: media.metadata.tags?.length ? media.metadata.tags : undefined,
    };
  }
}

function toSourceVideo(media: JWMedia): SourceVideo {
  return {
    sourceId: media.id,
    displayName: media.metadata.title || media.id,
    folderId: null,
    size: undefined,
    duration: media.metadata.duration || undefined,
  };
}
