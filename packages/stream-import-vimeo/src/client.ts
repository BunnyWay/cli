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
  VimeoFile,
  VimeoFolder,
  VimeoPaginatedResponse,
  VimeoVideo,
} from "./types.ts";
import { validateVimeoId } from "./validate.ts";

const VIMEO_API_BASE = "https://api.vimeo.com";

const VIDEO_FIELDS =
  "uri,name,description,duration,width,height,created_time,modified_time,privacy,pictures,download,tags";

/** Vimeo account tiers, current and legacy, that include file download access. */
const PREMIUM_ACCOUNTS = [
  "standard",
  "advanced",
  "enterprise",
  "plus",
  "pro",
  "pro_unlimited",
  "premium",
  "business",
  "live_pro",
  "live_business",
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
      if (isHttpError(error, 403)) {
        throw new UserError(
          "Vimeo refused the access token (403).",
          "Regenerate it at https://developer.vimeo.com/apps with the public, private and video_files scopes.",
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

  async getVideo(
    videoId: string,
    signal?: AbortSignal,
  ): Promise<VimeoVideo | null> {
    const id = extractVideoId(videoId);
    if (!validateVimeoId(id))
      throw new UserError(`Invalid Vimeo video ID: ${videoId}`);

    try {
      // Not URI-encoded: the validated id is digits with an optional `:hash`, and Vimeo expects the colon as-is.
      return await this.http.get<VimeoVideo>(
        `/videos/${id}?fields=${VIDEO_FIELDS},files`,
        { signal },
      );
    } catch (error) {
      if (isHttpError(error, 404)) return null;
      throw error;
    }
  }

  async getVideoDownloadLink(videoId: string): Promise<VimeoDownload | null> {
    const video = await this.getVideo(videoId);

    return video ? selectDownload(video) : null;
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

  const progressive = (video.files ?? []).filter(isProgressiveMp4);
  if (progressive.length) {
    const [best] = progressive.sort(
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

/** Only a single progressive MP4 can be fetched by Bunny; `hls` and `dash` entries are streaming manifests. */
function isProgressiveMp4(file: VimeoFile): boolean {
  if (file.type !== "video/mp4" || !file.link) return false;
  if (file.quality === "hls" || file.quality === "dash") return false;
  try {
    return !/\.(?:m3u8|mpd)$/i.test(new URL(file.link).pathname);
  } catch {
    return false;
  }
}

/** `/users/1/projects/12345` -> `12345` */
export function extractFolderId(uri: string): string {
  return uri.split("/").at(-1) ?? "";
}

/** `/videos/123456789` -> `123456789`; an unlisted `/videos/123:abc` keeps its hash. */
export function extractVideoId(uri: string): string {
  return uri.replace(/^\/videos\//, "");
}
