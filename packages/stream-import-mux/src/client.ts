/**
 * Mux Video API. https://docs.mux.com/api-reference/video
 *
 * Downloads come from static renditions at `stream.mux.com/{playback_id}/...`
 * or from temporary master access.
 */

import {
  createHttp,
  type Http,
  isHttpError,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type { MuxAsset, MuxConfig } from "./types.ts";

const PAGE_LIMIT = 100;
const RENDITION_PRIORITY = ["high.mp4", "medium.mp4", "low.mp4"];

export class MuxClient {
  private readonly http: Http;

  constructor(config: MuxConfig, ctx: SourceContext) {
    this.http = createHttp({
      label: "Mux",
      baseUrl: "https://api.mux.com/video/v1",
      timeout: ctx.requestTimeout,
      userAgent: ctx.userAgent,
      auth: { username: config.tokenId, password: config.tokenSecret },
      onRetry: (message) => ctx.logger.warn(message),
    });
  }

  async validateCredentials(): Promise<void> {
    try {
      await this.http.get("/assets", { params: { limit: 1 } });
    } catch (error) {
      if (isHttpError(error, 401)) {
        throw new UserError(
          "Invalid Mux credentials.",
          "Create an access token at https://dashboard.mux.com/settings/api-keys.",
        );
      }
      throw error;
    }
  }

  async getAccountInfo(): Promise<Record<string, string>> {
    const data = await this.http.get("/assets", { params: { limit: 1 } });

    return { "Assets visible": data.data?.length ? "yes" : "none" };
  }

  /** Only `ready` assets can be fetched. */
  async listAssets(): Promise<MuxAsset[]> {
    const assets: MuxAsset[] = [];

    for (let page = 1; ; page++) {
      const data = await this.http.get("/assets", {
        params: { limit: PAGE_LIMIT, page },
      });
      const items = (data.data ?? []) as MuxAsset[];
      assets.push(...items.filter((a) => a.status === "ready"));
      if (items.length < PAGE_LIMIT) break;
    }

    return assets;
  }

  async getAsset(assetId: string): Promise<MuxAsset> {
    const data = await this.http.get(`/assets/${encodeURIComponent(assetId)}`);

    return data.data;
  }

  getDownloadUrl(asset: MuxAsset): { url: string; size: number } | null {
    return downloadForAsset(asset);
  }
}

/** Only a public playback ID can back a stream.mux.com URL: a signed one needs a JWT Bunny cannot supply, so those assets fall through to the master. */
export function downloadForAsset(
  asset: MuxAsset,
): { url: string; size: number } | null {
  const publicId = asset.playback_ids?.find((p) => p.policy === "public")?.id;
  const mp4 = asset.mp4_support !== "none";

  if (publicId && mp4 && asset.static_renditions?.status === "ready") {
    const files = asset.static_renditions.files ?? [];
    for (const name of RENDITION_PRIORITY) {
      const file = files.find((f) => f.name === name);
      if (file) {
        return {
          url: `https://stream.mux.com/${publicId}/${name}`,
          size: file.filesize || 0,
        };
      }
    }
  }

  if (asset.master_access === "temporary" && asset.master?.url) {
    return { url: asset.master.url, size: 0 };
  }

  // MP4 support is on but the rendition list has not caught up yet; the URL is deterministic and resolves once encoding finishes.
  if (publicId && mp4) {
    return { url: `https://stream.mux.com/${publicId}/high.mp4`, size: 0 };
  }

  return null;
}
