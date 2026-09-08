export interface JWMedia {
  id: string;
  type: string;
  created: string;
  last_modified: string;
  metadata: {
    title: string;
    description?: string;
    tags?: string[];
    duration?: number;
    custom_params?: Record<string, string>;
  };
  /** "ready" | "processing" | "failed" */
  status: string;
  media_type?: string;
  hosting_type?: string;
}

export interface JWMediaSource {
  file: string;
  /** "video/mp4", "application/vnd.apple.mpegurl" */
  type: string;
  width?: number;
  height?: number;
  filesize?: number;
  label?: string;
}

export interface JWPlayerConfig {
  apiKey: string;
  siteId: string;
}
