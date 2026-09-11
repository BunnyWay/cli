import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceVideo,
} from "@bunny.net/stream-import";
import type { BrightcoveClient } from "./client.ts";
import type { BrightcoveVideo } from "./types.ts";

/** Brightcove has native folders, which map one-to-one onto Bunny collections. */
export class BrightcoveAdapter implements SourceAdapter {
  readonly id = "brightcove";
  readonly dedupTag = "brightcoveId";

  constructor(private readonly client: BrightcoveClient) {}

  validateCredentials(): Promise<void> {
    return this.client.validateCredentials();
  }

  getAccountInfo(): Promise<Record<string, string>> {
    return this.client.getAccountInfo();
  }

  async listContent(opts?: { folderId?: string }): Promise<SourceContent> {
    if (opts?.folderId) {
      const folderId = opts.folderId;
      const [videos, folders] = await Promise.all([
        this.client.listVideos(folderId),
        this.client.listFolders(),
      ]);
      const folder = folders.find((f) => f.id === folderId);

      return {
        folders: folder
          ? [{ id: folder.id, name: folder.name, videoCount: videos.length }]
          : [],
        videos: new Map([
          [folderId, videos.map((v) => toSourceVideo(v, folderId))],
        ]),
        uncategorizedVideos: [],
      };
    }

    const folders = await this.client.listFolders();
    const videos = new Map<string, SourceVideo[]>();
    const filed = new Set<string>();

    for (const folder of folders) {
      const folderVideos = await this.client.listVideos(folder.id);
      for (const v of folderVideos) filed.add(v.id);
      videos.set(
        folder.id,
        folderVideos.map((v) => toSourceVideo(v, folder.id)),
      );
    }

    const all = await this.client.listVideos();

    return {
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        videoCount: f.video_count,
      })),
      videos,
      uncategorizedVideos: all
        .filter((v) => !filed.has(v.id))
        .map((v) => toSourceVideo(v, null)),
    };
  }

  async getDownloadInfo(
    sourceId: string,
    fallbackTitle?: string,
  ): Promise<DownloadInfo | null> {
    const download = await this.client.getDownloadUrl(sourceId);
    if (!download) return null;

    const video = await this.client.getVideo(sourceId);

    return {
      url: download.url,
      title: video.name || fallbackTitle || sourceId,
      description: video.description ?? undefined,
      tags: video.tags?.length ? video.tags : undefined,
    };
  }
}

function toSourceVideo(
  video: BrightcoveVideo,
  folderId: string | null,
): SourceVideo {
  return {
    sourceId: video.id,
    displayName: video.name,
    folderId,
    size: undefined,
    // Brightcove reports duration in milliseconds.
    duration: video.duration ? video.duration / 1000 : undefined,
  };
}
