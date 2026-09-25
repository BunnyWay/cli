// Mux Video API: https://docs.mux.com/api-reference/video

import {
  createHttp,
  type Http,
  isHttpError,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type { MuxAsset, MuxConfig } from "./types.ts";

const PAGE_LIMIT = 100;
/** Best-first across the current per-file renditions and the deprecated `mp4_support` names. */
const RENDITION_PRIORITY = [
  "highest.mp4",
  "capped-1080p.mp4",
  "2160p.mp4",
  "1440p.mp4",
  "1080p.mp4",
  "high.mp4",
  "720p.mp4",
  "medium.mp4",
  "540p.mp4",
  "480p.mp4",
  "360p.mp4",
  "low.mp4",
  "270p.mp4",
];

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

/** The master (original) when temporary access has it ready, else a ready static MP4 on a public playback ID; a signed ID needs a JWT Bunny cannot supply. */
export function downloadForAsset(
  asset: MuxAsset,
): { url: string; size: number } | null {
  if (
    asset.master_access === "temporary" &&
    asset.master?.status === "ready" &&
    asset.master.url
  ) {
    return { url: asset.master.url, size: 0 };
  }

  const publicId = asset.playback_ids?.find((p) => p.policy === "public")?.id;
  if (!publicId) return null;

  const renditions = asset.static_renditions;
  // Current renditions report `status` per file; the deprecated API only reports it once for the set.
  const ready = (renditions?.files ?? []).filter((f) =>
    f.status ? f.status === "ready" : renditions?.status === "ready",
  );
  for (const name of RENDITION_PRIORITY) {
    const file = ready.find((f) => f.name === name);
    if (file) {
      return {
        url: `https://stream.mux.com/${publicId}/${name}`,
        size: Number(file.filesize) || 0,
      };
    }
  }

  return null;
}
