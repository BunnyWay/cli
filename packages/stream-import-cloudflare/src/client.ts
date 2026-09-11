/**
 * Cloudflare Stream API.
 * https://developers.cloudflare.com/stream/viewing-videos/download-videos/
 *
 * Downloads are not immediate: an MP4 has to be generated first, then polled
 * until ready.
 */

import {
  createHttp,
  type Http,
  isHttpError,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type { CfStreamVideo, CloudflareConfig } from "./types.ts";

const PER_PAGE = 100;
const DOWNLOAD_POLL_INTERVAL_MS = 5_000;
const DOWNLOAD_POLL_ATTEMPTS = 60;

export class CloudflareStreamClient {
  private readonly http: Http;
  private readonly accountId: string;

  constructor(config: CloudflareConfig, ctx: SourceContext) {
    this.accountId = config.accountId;
    this.http = createHttp({
      label: "Cloudflare Stream",
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/stream`,
      timeout: ctx.requestTimeout,
      userAgent: ctx.userAgent,
      headers: { Authorization: `Bearer ${config.apiToken}` },
      onRetry: (message) => ctx.logger.warn(message),
    });
  }

  async validateCredentials(): Promise<void> {
    try {
      await this.http.get("", { params: { per_page: 1 } });
    } catch (error) {
      if (isHttpError(error, 401) || isHttpError(error, 403)) {
        throw new UserError(
          "Invalid Cloudflare API token or account ID.",
          "The token needs the Stream:Read permission (https://dash.cloudflare.com/profile/api-tokens).",
        );
      }
      throw error;
    }
  }

  async getAccountInfo(): Promise<Record<string, string>> {
    return { "Account ID": this.accountId };
  }

  /** Cursor pagination: `after` takes the last uid from the previous page. */
  async listVideos(): Promise<CfStreamVideo[]> {
    const videos: CfStreamVideo[] = [];
    let cursor: string | undefined;

    while (true) {
      const data = await this.http.get("", {
        params: { per_page: PER_PAGE, after: cursor },
      });
      const items = (data.result ?? []) as CfStreamVideo[];
      if (items.length === 0) break;

      videos.push(...items.filter((v) => v.readyToStream));
      if (items.length < PER_PAGE) break;

      const next = items.at(-1)?.uid;
      // Without a usable cursor the next request would repeat this page forever.
      if (!next || next === cursor) break;
      cursor = next;
    }

    return videos;
  }

  async getVideo(uid: string): Promise<CfStreamVideo> {
    const data = await this.http.get(`/${encodeURIComponent(uid)}`);

    return data.result;
  }

  /** Returns an MP4 download, generating one if it does not exist yet. Polls for up to five minutes. */
  async getDownloadUrl(
    uid: string,
  ): Promise<{ url: string; size: number } | null> {
    const ready = await this.readDownload(uid);
    if (ready) return ready;

    try {
      await this.http.post(`/${encodeURIComponent(uid)}/downloads`);
    } catch (error) {
      // 409 means generation is already under way, which is fine.
      if (!isHttpError(error, 409)) throw error;
    }

    for (let attempt = 0; attempt < DOWNLOAD_POLL_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, DOWNLOAD_POLL_INTERVAL_MS));
      const download = await this.readDownload(uid);
      if (download) return download;
    }

    return null;
  }

  private async readDownload(
    uid: string,
  ): Promise<{ url: string; size: number } | null> {
    try {
      const data = await this.http.get(`/${encodeURIComponent(uid)}/downloads`);
      const dflt = data.result?.default;

      return dflt?.status === "ready" && dflt.url
        ? { url: dflt.url, size: 0 }
        : null;
    } catch {
      // No download has been requested for this video yet.
      return null;
    }
  }
}
