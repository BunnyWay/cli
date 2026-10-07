export interface BrightcoveVideo {
  id: string;
  name: string;
  description: string | null;
  long_description?: string | null;
  /** Milliseconds. */
  duration: number | null;
  created_at: string;
  updated_at: string;
  /** "ACTIVE" | "INACTIVE" | "DELETED" */
  state: string;
  tags: string[];
  folder_id: string | null;
  digital_master_id?: string;
}

export interface BrightcoveFolder {
  id: string;
  name: string;
  video_count: number;
  created_at: string;
  updated_at: string;
}

export interface BrightcoveSource {
  src: string;
  type?: string;
  /** "MP4", "M2TS" */
  container?: string;
  codec?: string;
  width?: number;
  height?: number;
  size?: number;
  duration?: number;
  asset_id?: string;
}

export interface BrightcoveConfig {
  clientId: string;
  clientSecret: string;
  accountId: string;
}
