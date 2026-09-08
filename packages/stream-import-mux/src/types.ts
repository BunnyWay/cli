export interface MuxRendition {
  /** "low.mp4", "medium.mp4", "high.mp4" */
  name: string;
  ext: string;
  width: number;
  height: number;
  bitrate: number;
  filesize: number;
}

export interface MuxAsset {
  id: string;
  /** "preparing" | "ready" | "errored" */
  status: string;
  duration: number;
  created_at: string;
  /** "none" | "temporary" */
  master_access: string;
  /** "none" | "standard" | "capped-1080p" | "audio-only" */
  mp4_support: string;
  passthrough?: string;
  playback_ids?: Array<{ id: string; policy: string }>;
  static_renditions?: { status: string; files?: MuxRendition[] };
  master?: { status: string; url?: string };
}

export interface MuxConfig {
  tokenId: string;
  tokenSecret: string;
}
