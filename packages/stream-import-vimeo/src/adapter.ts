import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceContext,
  SourceFolder,
  SourceVideo,
} from "@bunny.net/stream-import";
import {
  extractFolderId,
  extractVideoId,
  selectDownload,
  type VimeoClient,
} from "./client.ts";
import type { VimeoVideo } from "./types.ts";
import { validateVimeoUrl } from "./validate.ts";

export class VimeoSourceAdapter implements SourceAdapter {
  readonly id = "vimeo";
  readonly dedupTag = "vimeoId";

  constructor(
    private readonly client: VimeoClient,
    private readonly ctx: SourceContext,
  ) {}

  validateCredentials(): Promise<void> {
    return this.client.validateCredentials();
  }

  getAccountInfo(): Promise<Record<string, string>> {
    return this.client.getAccountInfo();
  }

  validateUrl(url: string): boolean {
    return validateVimeoUrl(url);
  }

  async listContent(opts?: { folderId?: string }): Promise<SourceContent> {
    if (opts?.folderId) {
      const folderId = opts.folderId;
      const [allFolders, folderVideos] = await Promise.all([
        this.client.listFolders(),
        this.client.listVideos(folderId),
      ]);

      const match = allFolders.find((f) => extractFolderId(f.uri) === folderId);
      const folders: SourceFolder[] = match
        ? [{ id: folderId, name: match.name, videoCount: folderVideos.length }]
        : [];

      return {
        folders,
        videos: new Map([
          [folderId, folderVideos.map((v) => toSourceVideo(v, folderId))],
        ]),
        uncategorizedVideos: [],
      };
    }

    const result = await this.client.getAllVideosWithFolders();
    this.ctx.logger.debug(`Vimeo: ${result.folders.length} folders`);

    const videos = new Map<string, SourceVideo[]>();
    for (const [folderId, folderVideos] of result.videos) {
      videos.set(
        folderId,
        folderVideos.map((v) => toSourceVideo(v, folderId)),
      );
    }

    return {
      folders: result.folders.map((f) => ({
        id: extractFolderId(f.uri),
        name: f.name,
        videoCount: f.metadata.connections.videos.total,
      })),
      videos,
      uncategorizedVideos: result.uncategorizedVideos.map((v) =>
        toSourceVideo(v, null),
      ),
    };
  }

  async getDownloadInfo(sourceId: string): Promise<DownloadInfo | null> {
    const video = await this.client.getVideo(sourceId);
    const download = selectDownload(video);
    if (!download) return null;

    return {
      url: download.link,
      title: video.name,
      description: video.description ?? undefined,
      tags: video.tags?.map((t) => t.name),
    };
  }
}

function toSourceVideo(
  video: VimeoVideo,
  folderId: string | null,
): SourceVideo {
  return {
    sourceId: extractVideoId(video.uri),
    displayName: video.name,
    folderId,
    // Undefined rather than 0 when Vimeo reports no download size, so the summary can tell "no videos" from "size unknown".
    size: video.download?.[0]?.size,
    duration: video.duration || undefined,
  };
}
