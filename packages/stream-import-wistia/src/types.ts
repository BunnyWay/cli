export interface WistiaProject {
  id: number;
  name: string;
  description: string | null;
  mediaCount: number;
  created: string;
  updated: string;
  hashedId: string;
}

export interface WistiaAsset {
  url: string;
  width: number;
  height: number;
  fileSize: number;
  contentType: string;
  /** "OriginalFile", "HdMp4Video", "MdMp4Video", "SdMp4Video", ... */
  type: string;
}

export interface WistiaMedia {
  id: number;
  name: string;
  hashed_id: string;
  description: string | null;
  duration: number;
  created: string;
  updated: string;
  /** "Video", "Image", "Audio", ... */
  type: string;
  /** "ready", "queued", "processing", "failed" */
  status: string;
  project?: { id: number; name: string; hashed_id: string };
  assets?: WistiaAsset[];
}

export interface WistiaConfig {
  accessToken: string;
}
