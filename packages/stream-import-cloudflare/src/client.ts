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

/** The API's maximum and default page size. */
const PAGE_LIMIT = 1000;
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
      await this.http.get("", { params: { limit: 1 } });
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

  /** Date-cursor pagination: `after` is an exclusive RFC 3339 creation time, so the list is walked oldest-first. */
  async listVideos(): Promise<CfStreamVideo[]> {
    const videos: CfStreamVideo[] = [];
    const seen = new Set<string>();
    let after: string | undefined;

    while (true) {
      const data = await this.http.get("", {
        params: { limit: PAGE_LIMIT, asc: true, after },
      });
      const items = (data.result ?? []) as CfStreamVideo[];
      let added = 0;
      for (const video of items) {
        if (seen.has(video.uid)) continue;
        seen.add(video.uid);
        added++;
        if (video.readyToStream) videos.push(video);
      }

      const last = items.at(-1)?.created;
      // A page of nothing new means the cursor cannot advance: the only exit besides a short page.
      if (added === 0 || items.length < PAGE_LIMIT || !last) break;
      // `created` has second precision and `after` is exclusive, so step back one second and let `seen` absorb the repeats rather than drop a boundary video.
      after = new Date(new Date(last).getTime() - 1000).toISOString();
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
