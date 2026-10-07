// Cloudflare Stream API; an MP4 download is generated on request, then polled until ready: https://developers.cloudflare.com/stream/viewing-videos/download-videos/

import {
  createHttp,
  type Http,
  isHttpError,
  type Logger,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type { CfDownload, CfStreamVideo, CloudflareConfig } from "./types.ts";

/** The API's maximum and default page size. */
const PAGE_LIMIT = 1000;
const DOWNLOAD_POLL_INTERVAL_MS = 5_000;
const DOWNLOAD_POLL_ATTEMPTS = 60;
/** Stream serves downloads from these domains and their subdomains (`customer-<code>.cloudflarestream.com`). */
const DOWNLOAD_DOMAINS = ["cloudflarestream.com", "videodelivery.net"];
const STREAM_EDIT_HINT =
  "Give the token the Stream:Edit permission (https://dash.cloudflare.com/profile/api-tokens).";

export class CloudflareStreamClient {
  private readonly http: Http;
  private readonly accountId: string;
  private readonly logger: Logger;

  constructor(config: CloudflareConfig, ctx: SourceContext) {
    this.accountId = config.accountId;
    this.logger = ctx.logger;
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
      if (isHttpError(error, 401)) {
        throw new UserError(
          "Invalid Cloudflare API token or account ID.",
          STREAM_EDIT_HINT,
        );
      }
      if (isHttpError(error, 403)) {
        throw new UserError(
          `Cloudflare refused access to Stream on account ${this.accountId} (403).`,
          STREAM_EDIT_HINT,
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
      if (items.length < PAGE_LIMIT || !last) break;
      // A full page of nothing new means more than a page shares one `created` second, so the cursor cannot advance.
      if (added === 0) {
        this.logger.warn(
          `Cloudflare Stream: more than ${PAGE_LIMIT} videos share the creation time ${last}; videos after it may be missing from this listing.`,
        );
        break;
      }
      // `created` has second precision and `after` is exclusive, so step back one second and let `seen` absorb the repeats rather than drop a boundary video.
      after = new Date(new Date(last).getTime() - 1000).toISOString();
    }

    return videos;
  }

  async getVideo(
    uid: string,
    signal?: AbortSignal,
  ): Promise<CfStreamVideo | null> {
    try {
      const data = await this.http.get(`/${encodeURIComponent(uid)}`, {
        signal,
      });

      return data.result;
    } catch (error) {
      if (isHttpError(error, 404)) return null;
      throw error;
    }
  }

  /** Returns an MP4 download, generating one if it does not exist yet. Polls for up to five minutes. */
  async getDownloadUrl(
    uid: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; size: number } | null> {
    const ready = await this.readDownload(uid, signal);
    if (ready) return ready;

    try {
      await this.http.post(`/${encodeURIComponent(uid)}/downloads`, undefined, {
        signal,
      });
    } catch (error) {
      if (isHttpError(error, 403)) {
        throw new UserError(
          "Cloudflare refused to generate an MP4 download (403).",
          STREAM_EDIT_HINT,
        );
      }
      // 409 means generation is already under way, which is fine.
      if (!isHttpError(error, 409)) throw error;
    }

    for (let attempt = 0; attempt < DOWNLOAD_POLL_ATTEMPTS; attempt++) {
      await sleep(DOWNLOAD_POLL_INTERVAL_MS, signal);
      signal?.throwIfAborted();
      const download = await this.readDownload(uid, signal);
      if (download) return download;
    }

    return null;
  }

  /** The ready download, or null while none exists or it is still generating; throws when generation failed. */
  private async readDownload(
    uid: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; size: number } | null> {
    let dflt: CfDownload | undefined;
    try {
      const data = await this.http.get(
        `/${encodeURIComponent(uid)}/downloads`,
        {
          signal,
        },
      );
      dflt = data.result?.default;
    } catch (error) {
      // 404 means no download has been requested yet; auth and rate-limit failures must surface.
      if (isHttpError(error, 404)) return null;
      throw error;
    }

    if (dflt?.status === "error") {
      throw new Error(
        `Cloudflare could not generate an MP4 download${dflt.error ? `: ${dflt.error}` : ""}`,
      );
    }

    return dflt?.status === "ready" && dflt.url
      ? { url: dflt.url, size: 0 }
      : null;
  }
}

/** HTTPS on a Cloudflare Stream download host only. */
export function validateCloudflareUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    return (
      parsed.protocol === "https:" &&
      DOWNLOAD_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
    );
  } catch {
    return false;
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
