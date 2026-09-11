import {
  createHttp,
  type Http,
  isHttpError,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import type {
  VimeoConfig,
  VimeoDownload,
  VimeoFolder,
  VimeoPaginatedResponse,
  VimeoVideo,
} from "./types.ts";
import { validateVimeoId } from "./validate.ts";

const VIMEO_API_BASE = "https://api.vimeo.com";

const VIDEO_FIELDS =
  "uri,name,description,duration,width,height,created_time,modified_time,privacy,pictures,download,tags";

/** Vimeo account tiers that include original-file download access. */
const PREMIUM_ACCOUNTS = [
  "standard",
  "advanced",
  "pro",
  "plus",
  "premium",
  "business",
  "live_premium",
  "producer",
];

export class VimeoClient {
  private readonly http: Http;

  constructor(config: VimeoConfig, ctx: SourceContext) {
    this.http = createHttp({
      label: "Vimeo",
      baseUrl: VIMEO_API_BASE,
      timeout: ctx.requestTimeout,
      userAgent: ctx.userAgent,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/vnd.vimeo.*+json;version=3.4",
      },
      onRetry: (message) => ctx.logger.warn(message),
    });
  }

  async validateCredentials(): Promise<void> {
    try {
      await this.http.get("/me");
    } catch (error) {
      if (isHttpError(error, 401)) {
        throw new UserError(
          "Invalid Vimeo access token.",
          "Create one at https://developer.vimeo.com/apps with the public, private and video_files scopes.",
        );
      }
      throw error;
    }
  }

  async getAccountInfo(): Promise<Record<string, string>> {
    const data = await this.http.get("/me");
    const tier = String(data.account ?? "").toLowerCase();

    return {
      Name: data.name ?? "Unknown",
      Account: data.account ?? "unknown",
      // Free and Starter accounts cannot expose original files, the most common reason a Vimeo import has no download link.
      "Download access": PREMIUM_ACCOUNTS.includes(tier) ? "yes" : "no",
    };
  }

  async listFolders(): Promise<VimeoFolder[]> {
    const folders: VimeoFolder[] = [];
    let next: string | null = "/me/projects?per_page=100";

    while (next !== null) {
      const data: VimeoPaginatedResponse<VimeoFolder> =
        await this.http.get(next);
      folders.push(...data.data);
      next = data.paging.next;
    }

    return folders;
  }

  async listVideos(folderId?: string): Promise<VimeoVideo[]> {
    if (folderId && !validateVimeoId(folderId)) {
      throw new UserError(`Invalid Vimeo folder ID: ${folderId}`);
    }

    const videos: VimeoVideo[] = [];
    let next: string | null = folderId
      ? `/me/projects/${encodeURIComponent(folderId)}/videos?per_page=100&fields=${VIDEO_FIELDS}`
      : `/me/videos?per_page=100&fields=${VIDEO_FIELDS}`;

    while (next !== null) {
      const data: VimeoPaginatedResponse<VimeoVideo> =
        await this.http.get(next);
      videos.push(...data.data);
      next = data.paging.next;
    }

    return videos;
  }

  async getVideo(videoId: string): Promise<VimeoVideo> {
    const id = extractVideoId(videoId);
    if (!validateVimeoId(id))
      throw new UserError(`Invalid Vimeo video ID: ${videoId}`);

    return this.http.get<VimeoVideo>(
      `/videos/${encodeURIComponent(id)}?fields=${VIDEO_FIELDS},files`,
    );
  }

  async getVideoDownloadLink(videoId: string): Promise<VimeoDownload | null> {
    return selectDownload(await this.getVideo(videoId));
  }

  async getAllVideosWithFolders(): Promise<{
    folders: VimeoFolder[];
    videos: Map<string, VimeoVideo[]>;
    uncategorizedVideos: VimeoVideo[];
  }> {
    const folders = await this.listFolders();
    const videos = new Map<string, VimeoVideo[]>();
    const filed = new Set<string>();

    for (const folder of folders) {
      const folderId = extractFolderId(folder.uri);
      const folderVideos = await this.listVideos(folderId);
      videos.set(folderId, folderVideos);
      for (const v of folderVideos) filed.add(v.uri);
    }

    const all = await this.listVideos();

    return {
      folders,
      videos,
      uncategorizedVideos: all.filter((v) => !filed.has(v.uri)),
    };
  }
}

/** Best available source: a real download link if the account tier allows one, otherwise the highest-resolution streaming file. */
export function selectDownload(video: VimeoVideo): VimeoDownload | null {
  if (video.download?.length) {
    const [best] = [...video.download].sort((a, b) => {
      if (a.quality === "source") return -1;
      if (b.quality === "source") return 1;

      return (b.height || 0) - (a.height || 0);
    });

    return best ?? null;
  }

  if (video.files?.length) {
    const [best] = [...video.files].sort(
      (a, b) => (b.height || 0) - (a.height || 0),
    );
    if (!best) return null;

    return {
      ...best,
      // Streaming files do not carry an expiry; the field is only advisory.
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  return null;
}

/** `/users/1/projects/12345` -> `12345` */
export function extractFolderId(uri: string): string {
  return uri.split("/").at(-1) ?? "";
}

/** `/videos/123456789` -> `123456789` */
export function extractVideoId(uri: string): string {
  return uri.replace(/^\/videos\//, "");
}
