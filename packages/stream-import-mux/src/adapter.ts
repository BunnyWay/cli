import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceVideo,
} from "@bunny.net/stream-import";
import type { MuxClient } from "./client.ts";
import type { MuxAsset } from "./types.ts";

/** Mux has no folder concept; every asset is uncategorized. */
export class MuxSourceAdapter implements SourceAdapter {
  readonly id = "mux";
  readonly dedupTag = "muxAssetId";

  constructor(private readonly client: MuxClient) {}

  validateCredentials(): Promise<void> {
    return this.client.validateCredentials();
  }

  getAccountInfo(): Promise<Record<string, string>> {
    return this.client.getAccountInfo();
  }

  async listContent(): Promise<SourceContent> {
    const assets = await this.client.listAssets();

    return {
      folders: [],
      videos: new Map(),
      uncategorizedVideos: assets.map(toSourceVideo),
    };
  }

  async getDownloadInfo(
    sourceId: string,
    fallbackTitle?: string,
  ): Promise<DownloadInfo | null> {
    const asset = await this.client.getAsset(sourceId);
    const download = this.client.getDownloadUrl(asset);
    if (!download) return null;

    return {
      url: download.url,
      title: asset.passthrough || fallbackTitle || sourceId,
      description: asset.passthrough || undefined,
    };
  }
}

function toSourceVideo(asset: MuxAsset): SourceVideo {
  return {
    sourceId: asset.id,
    // Mux has no title field; `passthrough` is where a title usually lands.
    displayName: asset.passthrough || asset.id,
    folderId: null,
    size: undefined,
    duration: asset.duration || undefined,
  };
}
