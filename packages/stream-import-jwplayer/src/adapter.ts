import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceVideo,
} from "@bunny.net/stream-import";
import { type JWPlayerClient, validateJWPlayerUrl } from "./client.ts";
import type { JWMedia } from "./types.ts";

/** JW Player has no folder concept; every media item is uncategorized. */
export class JWPlayerAdapter implements SourceAdapter {
  readonly id = "jwplayer";
  readonly dedupTag = "jwPlayerId";

  /** Download URLs of externally hosted media, which are not on the JW Player CDN. */
  private readonly externalUrls = new Set<string>();

  constructor(private readonly client: JWPlayerClient) {}

  validateUrl(url: string): boolean {
    return validateJWPlayerUrl(url, this.externalUrls.has(url));
  }

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
    signal?: AbortSignal,
  ): Promise<DownloadInfo | null> {
    const media = await this.client.getMedia(sourceId, signal);
    if (!media) return null;
    const download = await this.client.getDownloadUrl(media, signal);
    if (!download) return null;
    if (media.hosting_type === "external") this.externalUrls.add(download.url);

    return {
      url: download.url,
      title: media.metadata.title || "",
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
