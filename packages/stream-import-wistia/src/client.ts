// Wistia Data API (projects are folders, medias are videos, assets are renditions): https://docs.wistia.com/reference/get_medias

import {
  createHttp,
  type Http,
  isHttpError,
  type Query,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type { WistiaConfig, WistiaMedia, WistiaProject } from "./types.ts";

const PER_PAGE = 100;

/** Best-first: the original wins because Bunny transcodes any format, then the MP4 renditions from HD down. */
const ASSET_PRIORITY = [
  "OriginalFile",
  "HdMp4VideoFile",
  "MdMp4VideoFile",
  "Mp4VideoFile",
  "IPhoneVideoFile",
];

/** Wistia serves delivery URLs from these domains and their subdomains. */
const DELIVERY_DOMAINS = ["wistia.com", "wistia.net"];

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
      if (isHttpError(error, 403)) {
        throw new UserError(
          "Wistia refused the access token (403).",
          "Give the token the Read all data permission under Account > API Access in Wistia.",
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

  /** Video medias in a project, paged from `/medias.json` (which takes the numeric project id) oldest-first so pages stay stable. */
  async listMediaInProject(projectId: number): Promise<WistiaMedia[]> {
    const medias = await this.paginate<WistiaMedia>("/medias.json", {
      project_id: projectId,
      sort_by: "created",
      sort_direction: 1,
    });

    return medias.filter((m) => m.type === "Video");
  }

  async getMedia(
    hashedId: string,
    signal?: AbortSignal,
  ): Promise<WistiaMedia | null> {
    try {
      return await this.http.get<WistiaMedia>(
        `/medias/${encodeURIComponent(hashedId)}.json`,
        { signal },
      );
    } catch (error) {
      if (isHttpError(error, 404)) return null;
      throw error;
    }
  }

  /** Wistia paginates with `page`/`per_page` and signals the end with a short page. */
  private async paginate<T>(path: string, params: Query = {}): Promise<T[]> {
    const all: T[] = [];

    for (let page = 1; ; page++) {
      const data = await this.http.get(path, {
        params: { ...params, page, per_page: PER_PAGE },
      });
      const items = (data ?? []) as T[];
      if (items.length === 0) break;
      all.push(...items);
      if (items.length < PER_PAGE) break;
    }

    return all;
  }
}

/** The preferred asset of an already-fetched media, so callers needing the metadata too make one request. Throws for a media Wistia has not finished processing. */
export function selectDownload(
  media: WistiaMedia,
): { url: string; size: number } | null {
  if (media.status && media.status !== "ready") {
    throw new Error(`Wistia media is ${media.status}, not ready for download`);
  }
  if (!media.assets?.length) return null;

  const asset =
    ASSET_PRIORITY.map((type) =>
      media.assets?.find((a) => a.type === type),
    ).find(Boolean) ??
    media.assets.find((a) => a.contentType?.includes("video/mp4"));

  return asset ? { url: toHttps(asset.url), size: asset.fileSize } : null;
}

/** Wistia documents delivery URLs as `http://`, but its delivery hosts serve the same path over HTTPS. */
function toHttps(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" && isWistiaHost(parsed.hostname)) {
      parsed.protocol = "https:";
      return parsed.toString();
    }
  } catch {
    // Left as-is; validateWistiaUrl rejects it.
  }

  return url;
}

function isWistiaHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return DELIVERY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** HTTPS on a Wistia delivery host only, so a tampered asset URL cannot point Bunny elsewhere. */
export function validateWistiaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "https:" && isWistiaHost(parsed.hostname);
  } catch {
    return false;
  }
}
