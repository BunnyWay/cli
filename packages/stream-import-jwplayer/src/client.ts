/**
 * JW Player (JWX) Management API v2.
 * https://docs.jwplayer.com/platform/reference/overview
 */

import {
  createHttp,
  type Http,
  isHttpError,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type { JWMedia, JWMediaSource, JWPlayerConfig } from "./types.ts";

const PAGE_LENGTH = 100;

export class JWPlayerClient {
  private readonly http: Http;
  /** The public Delivery API takes no credentials, so it gets a client without the bearer header. */
  private readonly delivery: Http;
  private readonly siteId: string;

  constructor(config: JWPlayerConfig, ctx: SourceContext) {
    this.siteId = config.siteId;
    this.http = createHttp({
      label: "JW Player",
      baseUrl: `https://api.jwplayer.com/v2/sites/${encodeURIComponent(config.siteId)}`,
      timeout: ctx.requestTimeout,
      userAgent: ctx.userAgent,
      headers: { Authorization: `Bearer ${config.apiKey}` },
      onRetry: (message) => ctx.logger.warn(message),
    });
    this.delivery = createHttp({
      label: "JW Player",
      baseUrl: "https://cdn.jwplayer.com/v2",
      timeout: ctx.requestTimeout,
      userAgent: ctx.userAgent,
    });
  }

  async validateCredentials(): Promise<void> {
    try {
      await this.http.get("/media/", { params: { page_length: 1 } });
    } catch (error) {
      if (isHttpError(error, 401) || isHttpError(error, 403)) {
        throw new UserError(
          "Invalid JW Player API key or site ID.",
          "Both are available at https://dashboard.jwplayer.com.",
        );
      }
      throw error;
    }
  }

  async getAccountInfo(): Promise<Record<string, string>> {
    const data = await this.http.get("/media/", {
      params: { page_length: 1 },
    });

    return { "Site ID": this.siteId, Videos: String(data.total ?? 0) };
  }

  async listMedia(): Promise<JWMedia[]> {
    const media: JWMedia[] = [];

    for (let page = 1; ; page++) {
      const data = await this.http.get("/media/", {
        params: { page, page_length: PAGE_LENGTH },
      });
      const items = (data.media ?? []) as JWMedia[];
      media.push(...items.filter((m) => m.status === "ready"));
      if (items.length < PAGE_LENGTH) break;
    }

    return media;
  }

  async getMedia(mediaId: string): Promise<JWMedia> {
    return this.http.get<JWMedia>(`/media/${encodeURIComponent(mediaId)}/`);
  }

  /** Highest-resolution MP4 for an already-fetched media item. The Management API sometimes omits sources, in which case the Delivery API has them. */
  async getDownloadUrl(
    media: JWMedia,
  ): Promise<{ url: string; size: number } | null> {
    const fromManagement = await this.bestMp4(async () => media.sources ?? []);
    if (fromManagement) return fromManagement;

    return this.bestMp4(async () => {
      const data = await this.delivery.get(
        `/media/${encodeURIComponent(media.id)}`,
      );

      return data?.playlist?.[0]?.sources ?? [];
    });
  }

  private async bestMp4(
    load: () => Promise<JWMediaSource[]>,
  ): Promise<{ url: string; size: number } | null> {
    let sources: JWMediaSource[];
    try {
      sources = await load();
    } catch {
      return null;
    }

    const [best] = sources
      .filter(
        (s) => s.file && (s.type === "video/mp4" || s.file.endsWith(".mp4")),
      )
      .sort((a, b) => (b.width || 0) - (a.width || 0));

    return best ? { url: best.file, size: best.filesize || 0 } : null;
  }
}
