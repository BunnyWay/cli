import type {
  DownloadInfo,
  SourceAdapter,
  SourceContent,
  SourceVideo,
} from "@bunny.net/stream-import";
import { selectDownload, type WistiaClient } from "./client.ts";
import type { WistiaMedia } from "./types.ts";

export class WistiaSourceAdapter implements SourceAdapter {
  readonly id = "wistia";
  readonly dedupTag = "wistiaId";

  constructor(private readonly client: WistiaClient) {}

  validateCredentials(): Promise<void> {
    return this.client.validateCredentials();
  }

  getAccountInfo(): Promise<Record<string, string>> {
    return this.client.getAccountInfo();
  }

  async listContent(opts?: { folderId?: string }): Promise<SourceContent> {
    const projects = await this.client.listProjects();

    if (opts?.folderId) {
      const folderId = opts.folderId;
      const medias = await this.client.listMediaInProject(folderId);
      const project = projects.find((p) => p.hashedId === folderId);

      return {
        folders: project
          ? [{ id: folderId, name: project.name, videoCount: medias.length }]
          : [],
        videos: new Map([
          [folderId, medias.map((m) => toSourceVideo(m, folderId))],
        ]),
        uncategorizedVideos: [],
      };
    }

    const videos = new Map<string, SourceVideo[]>();
    for (const project of projects) {
      const medias = await this.client.listMediaInProject(project.hashedId);
      videos.set(
        project.hashedId,
        medias.map((m) => toSourceVideo(m, project.hashedId)),
      );
    }

    return {
      folders: projects.map((p) => ({
        id: p.hashedId,
        name: p.name,
        videoCount: p.mediaCount,
      })),
      videos,
      // Every Wistia media belongs to a project, so there is nothing loose.
      uncategorizedVideos: [],
    };
  }

  async getDownloadInfo(sourceId: string): Promise<DownloadInfo | null> {
    const media = await this.client.getMedia(sourceId);
    const download = selectDownload(media);
    if (!download) return null;

    return {
      url: download.url,
      title: media.name,
      description: media.description ?? undefined,
    };
  }
}

function toSourceVideo(
  media: WistiaMedia,
  folderId: string | null,
): SourceVideo {
  return {
    sourceId: media.hashed_id,
    displayName: media.name,
    folderId,
    size: media.assets?.[0]?.fileSize,
    duration: media.duration || undefined,
  };
}
