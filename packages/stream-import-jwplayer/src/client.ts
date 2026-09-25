// JW Player (JWX) Management API v2: https://docs.jwplayer.com/platform/reference/overview

import {
  createHttp,
  type Http,
  isHttpError,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type { JWMedia, JWMediaSource, JWPlayerConfig } from "./types.ts";

const PAGE_LENGTH = 1000;
/** The API returns at most this many media per query, however it is paged. */
const QUERY_CAP = 10_000;
/** Before any JW Player account existed, so the first window covers everything. */
const EPOCH_MS = Date.UTC(2005, 0, 1);
/** Delivery API download host; `hosting_type: external` media keep their own host. */
const DELIVERY_HOST = "cdn.jwplayer.com";

export class JWPlayerClient {
  private readonly http: Http;
  /** The public Delivery API takes no credentials, so it gets a client without the bearer header. */
  private readonly delivery: Http;
  private readonly siteId: string;
  private readonly warn: (message: string) => void;

  constructor(config: JWPlayerConfig, ctx: SourceContext) {
    this.warn = (message) => ctx.logger.warn(message);
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

  /** Walks `created` date windows oldest-first, halving any window at the 10,000-per-query cap. */
  async listMedia(): Promise<JWMedia[]> {
    const media = new Map<string, JWMedia>();
    const windows: Array<[number, number]> = [
      [EPOCH_MS, Date.now() + 24 * 60 * 60 * 1000],
    ];

    while (windows.length) {
      const [from, to] = windows.shift() as [number, number];
      const q = `created:[${jwDate(from)} TO ${jwDate(to)}]`;
      for (let page = 1, fetched = 0; ; page++) {
        const data = await this.http.get("/media/", {
          params: { q, sort: "created:asc", page, page_length: PAGE_LENGTH },
        });
        const total = Number(data.total ?? 0);
        // Windows are whole seconds and inclusive, so a split never overlaps.
        if (page === 1 && total >= QUERY_CAP && to - from >= 2000) {
          const mid = from + Math.floor((to - from) / 2000) * 1000;
          windows.unshift([from, mid], [mid + 1000, to]);
          break;
        }
        if (page === 1 && total >= QUERY_CAP)
          this.warn(
            `JW Player reports ${total} media created within one second; only the first ${QUERY_CAP} can be listed.`,
          );
        const items = (data.media ?? []) as JWMedia[];
        for (const m of items) if (m.status === "ready") media.set(m.id, m);
        fetched += items.length;
        if (items.length < PAGE_LENGTH || fetched >= total) break;
      }
    }

    return [...media.values()];
  }

  async getMedia(
    mediaId: string,
    signal?: AbortSignal,
  ): Promise<JWMedia | null> {
    try {
      return await this.http.get<JWMedia>(
        `/media/${encodeURIComponent(mediaId)}/`,
        { signal },
      );
    } catch (error) {
      if (isHttpError(error, 404)) return null;
      throw error;
    }
  }

  /** Highest-resolution MP4 for an already-fetched media item. The Management API sometimes omits sources, in which case the Delivery API has them. */
  async getDownloadUrl(
    media: JWMedia,
    signal?: AbortSignal,
  ): Promise<{ url: string; size: number } | null> {
    return (
      bestMp4(media.sources ?? []) ??
      bestMp4(await this.deliverySources(media.id, signal))
    );
  }

  private async deliverySources(
    mediaId: string,
    signal?: AbortSignal,
  ): Promise<JWMediaSource[]> {
    try {
      const data = await this.delivery.get(
        `/media/${encodeURIComponent(mediaId)}`,
        { signal },
      );

      return data?.playlist?.[0]?.sources ?? [];
    } catch (error) {
      if (isHttpError(error, 404)) return [];
      if (isHttpError(error, 403)) {
        throw new UserError(
          "JW Player refused the media download (403): this property has URL signing turned on, so Bunny cannot fetch its files.",
          "Turn off URL signing for the property in the JW Player dashboard, then re-run the import.",
        );
      }
      throw error;
    }
  }
}

function bestMp4(
  sources: JWMediaSource[],
): { url: string; size: number } | null {
  const [best] = sources
    .filter(
      (s) => s.file && (s.type === "video/mp4" || s.file.endsWith(".mp4")),
    )
    .sort((a, b) => (b.width || 0) - (a.width || 0));

  return best ? { url: best.file, size: best.filesize || 0 } : null;
}

/** JW Player's `q` range syntax takes UTC seconds without a zone suffix. */
function jwDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/** HTTPS on the JW Player CDN, unless the media is externally hosted, which keeps the default HTTPS check. */
export function validateJWPlayerUrl(url: string, external: boolean): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;

    return external || parsed.hostname.toLowerCase() === DELIVERY_HOST;
  } catch {
    return false;
  }
}
