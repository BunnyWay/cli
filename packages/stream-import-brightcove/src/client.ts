// Brightcove CMS API, with OAuth 2.0 client credentials: https://apis.support.brightcove.com/cms/

import {
  createHttp,
  type Http,
  isHttpError,
  type Query,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type {
  BrightcoveConfig,
  BrightcoveFolder,
  BrightcoveSource,
  BrightcoveVideo,
} from "./types.ts";

const PAGE_LIMIT = 100;
/** Renew slightly early so a token cannot expire mid-request. */
const TOKEN_SKEW_MS = 30_000;

export class BrightcoveClient {
  private readonly config: BrightcoveConfig;
  private readonly oauth: Http;
  private readonly http: Http;

  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  /** Shared across concurrent callers so a burst requests one token, not N. */
  private inflightToken: Promise<string> | null = null;

  constructor(config: BrightcoveConfig, ctx: SourceContext) {
    this.config = config;
    this.oauth = createHttp({
      label: "Brightcove",
      baseUrl: "https://oauth.brightcove.com/v4",
      timeout: ctx.requestTimeout,
      userAgent: ctx.userAgent,
      auth: { username: config.clientId, password: config.clientSecret },
    });
    this.http = createHttp({
      label: "Brightcove",
      baseUrl: `https://cms.api.brightcove.com/v1/accounts/${encodeURIComponent(config.accountId)}`,
      timeout: ctx.requestTimeout,
      userAgent: ctx.userAgent,
      onRetry: (message) => ctx.logger.warn(message),
    });
  }

  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_SKEW_MS) {
      return this.accessToken;
    }
    if (this.inflightToken) return this.inflightToken;

    this.inflightToken = (async () => {
      try {
        const data = await this.oauth.post(
          "/access_token",
          "grant_type=client_credentials",
        );
        const token = String(data.access_token);
        this.accessToken = token;
        this.tokenExpiresAt = Date.now() + (data.expires_in || 300) * 1000;

        return token;
      } catch (error) {
        if (isHttpError(error, 401) || isHttpError(error, 400)) {
          throw new UserError(
            "Invalid Brightcove credentials.",
            "Create an OAuth client at https://studio.brightcove.com/admin/oauthclient with CMS video read permissions.",
          );
        }
        throw error;
      } finally {
        this.inflightToken = null;
      }
    })();

    return this.inflightToken;
  }

  private async get<T = any>(
    path: string,
    params?: Query,
    signal?: AbortSignal,
  ): Promise<T> {
    const token = await this.ensureToken();

    return this.http.get<T>(path, {
      params,
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  }

  async validateCredentials(): Promise<void> {
    try {
      await this.get("/counts/videos");
    } catch (error) {
      if (isHttpError(error, 401) || isHttpError(error, 403)) {
        throw new UserError(
          `Brightcove refused access to account ${this.config.accountId}.`,
          "Check BRIGHTCOVE_ACCOUNT_ID, and that the OAuth client belongs to that account with CMS video read permissions.",
        );
      }
      throw error;
    }
  }

  async getAccountInfo(): Promise<Record<string, string>> {
    const data = await this.get("/counts/videos");

    return {
      "Account ID": this.config.accountId,
      Videos: String(data.count ?? 0),
    };
  }

  async listFolders(): Promise<BrightcoveFolder[]> {
    return (await this.get<BrightcoveFolder[] | null>("/folders")) ?? [];
  }

  /** Active videos, either across the account or within one folder. */
  async listVideos(folderId?: string): Promise<BrightcoveVideo[]> {
    const path = folderId
      ? `/folders/${encodeURIComponent(folderId)}/videos`
      : "/videos";
    const videos: BrightcoveVideo[] = [];

    for (let offset = 0; ; offset += PAGE_LIMIT) {
      const items =
        (await this.get<BrightcoveVideo[] | null>(path, {
          limit: PAGE_LIMIT,
          offset,
          sort: "created_at",
        })) ?? [];
      if (items.length === 0) break;
      videos.push(...items.filter((v) => v.state === "ACTIVE"));
      if (items.length < PAGE_LIMIT) break;
    }

    return videos;
  }

  async getVideo(
    videoId: string,
    signal?: AbortSignal,
  ): Promise<BrightcoveVideo | null> {
    try {
      return await this.get<BrightcoveVideo>(
        `/videos/${encodeURIComponent(videoId)}`,
        undefined,
        signal,
      );
    } catch (error) {
      if (isHttpError(error, 404)) return null;
      throw error;
    }
  }

  /** Highest-resolution HTTPS MP4 rendition; the digital master endpoint exposes no download URL. */
  async getDownloadUrl(
    videoId: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; size: number } | null> {
    const sources =
      (await this.get<BrightcoveSource[] | null>(
        `/videos/${encodeURIComponent(videoId)}/sources`,
        undefined,
        signal,
      )) ?? [];
    const best = bestMp4Source(sources);

    return best ? { url: best.src, size: best.size || 0 } : null;
  }
}

function isHttps(url: string): boolean {
  return url.startsWith("https://");
}

/** Widest HTTPS MP4 rendition; an http:// source would only be rejected later by the engine's URL guard. */
export function bestMp4Source(
  sources: BrightcoveSource[],
): BrightcoveSource | undefined {
  return sources
    .filter(
      (s) =>
        s.src &&
        isHttps(s.src) &&
        (s.container === "MP4" || s.type === "video/mp4"),
    )
    .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
}
