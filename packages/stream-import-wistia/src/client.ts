/**
 * Wistia Data API. Projects are folders, medias are videos, assets are
 * renditions. https://docs.wistia.com/reference/get_medias
 */

import {
  createHttp,
  type Http,
  isHttpError,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type { WistiaConfig, WistiaMedia, WistiaProject } from "./types.ts";

const PER_PAGE = 100;

/** Best-first: a real MP4 rendition beats the original, which may be a MOV. */
const ASSET_PRIORITY = [
  "HdMp4Video",
  "MdMp4Video",
  "SdMp4Video",
  "OriginalFile",
];

export class WistiaClient {
  private readonly http: Http;

  constructor(config: WistiaConfig, ctx: SourceContext) {
    this.http = createHttp({
      label: "Wistia",
      baseUrl: "https://api.wistia.com/v1",
      timeout: ctx.requestTimeout,
      userAgent: ctx.userAgent,
      headers: { Authorization: `Bearer ${config.accessToken}` },
      onRetry: (message) => ctx.logger.warn(message),
    });
  }

  async validateCredentials(): Promise<void> {
    try {
      await this.http.get("/account.json");
    } catch (error) {
      if (isHttpError(error, 401)) {
        throw new UserError(
          "Invalid Wistia access token.",
          "Create one under Account > API Access in Wistia.",
        );
      }
      throw error;
    }
  }

  async getAccountInfo(): Promise<Record<string, string>> {
    const data = await this.http.get("/account.json");

    return { Name: data.name ?? "Wistia Account", URL: data.url ?? "" };
  }

  async listProjects(): Promise<WistiaProject[]> {
    return this.paginate<WistiaProject>("/projects.json");
  }

  /** Video medias in a project. The project endpoint embeds them. */
  async listMediaInProject(projectHashedId: string): Promise<WistiaMedia[]> {
    const data = await this.http.get(
      `/projects/${encodeURIComponent(projectHashedId)}.json`,
    );

    return ((data.medias ?? []) as WistiaMedia[]).filter(
      (m) => m.type === "Video",
    );
  }

  async getMedia(hashedId: string): Promise<WistiaMedia> {
    return this.http.get<WistiaMedia>(
      `/medias/${encodeURIComponent(hashedId)}.json`,
    );
  }

  async getDownloadUrl(
    hashedId: string,
  ): Promise<{ url: string; size: number } | null> {
    const media = await this.getMedia(hashedId);
    if (!media.assets?.length) return null;

    for (const preferred of ASSET_PRIORITY) {
      const asset = media.assets.find((a) => a.type === preferred);
      if (asset) return { url: asset.url, size: asset.fileSize };
    }

    const mp4 = media.assets.find((a) => a.contentType?.includes("video/mp4"));

    return mp4 ? { url: mp4.url, size: mp4.fileSize } : null;
  }

  /** Wistia paginates with `page`/`per_page` and signals the end with a short page. */
  private async paginate<T>(path: string): Promise<T[]> {
    const all: T[] = [];

    for (let page = 1; ; page++) {
      const data = await this.http.get(path, {
        params: { page, per_page: PER_PAGE },
      });
      const items = (data ?? []) as T[];
      if (items.length === 0) break;
      all.push(...items);
      if (items.length < PER_PAGE) break;
    }

    return all;
  }
}
