import {
  type DownloadInfo,
  type SourceAdapter,
  type SourceContent,
  type SourceVideo,
  UserError,
} from "@bunny.net/stream-import";
import {
  selectDownload,
  validateWistiaUrl,
  type WistiaClient,
} from "./client.ts";
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

  validateUrl(url: string): boolean {
    return validateWistiaUrl(url);
  }

  async listContent(opts?: { folderId?: string }): Promise<SourceContent> {
    const projects = await this.client.listProjects();

    if (opts?.folderId) {
      const folderId = opts.folderId;
      const project = projects.find((p) => p.hashedId === folderId);
      if (!project) {
        const byNumber = projects.find((p) => String(p.id) === folderId);
        throw new UserError(
          `No Wistia project with ID ${folderId}.`,
          byNumber
            ? `Use the project's hashed ID instead: ${byNumber.hashedId}.`
            : "Use the project's hashed ID, as shown in its Wistia URL.",
        );
      }
      const id = project.hashedId;
      const medias = await this.client.listMediaInProject(project.id);

      return {
        folders: [{ id, name: project.name, videoCount: medias.length }],
        videos: new Map([[id, medias.map((m) => toSourceVideo(m, id))]]),
        uncategorizedVideos: [],
      };
    }

    const videos = new Map<string, SourceVideo[]>();
    for (const project of projects) {
      const medias = await this.client.listMediaInProject(project.id);
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

  async getDownloadInfo(
    sourceId: string,
    signal?: AbortSignal,
  ): Promise<DownloadInfo | null> {
    const media = await this.client.getMedia(sourceId, signal);
    if (!media) return null;
    const download = selectDownload(media);
    if (!download) return null;

    return {
      url: download.url,
      title: media.name ?? "",
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
