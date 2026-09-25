import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceVideo,
} from "@bunny.net/stream-import";
import { type MuxClient, validateMuxUrl } from "./client.ts";
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

  validateUrl(url: string): boolean {
    return validateMuxUrl(url);
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
    signal?: AbortSignal,
  ): Promise<DownloadInfo | null> {
    const asset = await this.client.getAsset(sourceId, signal);
    if (!asset) return null;
    const download = this.client.getDownloadUrl(asset);
    if (!download) return null;

    return {
      url: download.url,
      title: titleOf(asset) || "",
    };
  }
}

function toSourceVideo(asset: MuxAsset): SourceVideo {
  return {
    sourceId: asset.id,
    displayName: titleOf(asset) || asset.id,
    folderId: null,
    size: undefined,
    duration: asset.duration || undefined,
  };
}

/** `meta.title` is Mux's title field; older assets often carry a title in `passthrough` instead. */
function titleOf(asset: MuxAsset): string | undefined {
  return asset.meta?.title || asset.passthrough || undefined;
}
