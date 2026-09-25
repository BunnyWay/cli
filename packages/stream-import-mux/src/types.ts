export interface MuxRendition {
  /** "highest.mp4", "1080p.mp4", "audio.m4a", or the deprecated "high.mp4", "medium.mp4", "low.mp4", "capped-1080p.mp4" */
  name: string;
  ext: string;
  /** Per-file on current renditions: "preparing" | "ready" | "skipped" | "errored"; absent on the deprecated API. */
  status?: string;
  resolution?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  /** A numeric string on current renditions, a number on the deprecated API. */
  filesize?: number | string;
}

export interface MuxAsset {
  id: string;
  /** "preparing" | "ready" | "errored" */
  status: string;
  duration: number;
  created_at: string;
  /** "none" | "temporary" */
  master_access: string;
  /** Deprecated: "none" | "standard" | "capped-1080p" | "audio-only"; absent on assets using per-file static renditions. */
  mp4_support?: string;
  passthrough?: string;
  meta?: { title?: string; creator_id?: string; external_id?: string };
  playback_ids?: Array<{ id: string; policy: string }>;
  /** `status` is the deprecated set-level state; current renditions carry it per file. */
  static_renditions?: { status?: string; files?: MuxRendition[] };
  master?: { status: string; url?: string };
  /** "video" | "audio" | "text" */
  tracks?: Array<{ type: string }>;
}

export interface MuxConfig {
  tokenId: string;
  tokenSecret: string;
}
