export interface CfStreamVideo {
  uid: string;
  thumbnail: string;
  readyToStream: boolean;
  /** The MP4 download then needs a signed token Bunny cannot supply. */
  requireSignedURLs?: boolean;
  status: { state: string; pctComplete?: string };
  meta?: Record<string, string>;
  created: string;
  modified: string;
  size: number;
  duration: number;
  input?: { width: number; height: number };
  playback?: { hls: string; dash: string };
  creator?: string;
}

export interface CloudflareConfig {
  apiToken: string;
  accountId: string;
}
