export interface VimeoFile {
  quality: string;
  type: string;
  width: number;
  height: number;
  link: string;
  size: number;
}

export interface VimeoDownload extends VimeoFile {
  expires: string;
}

export interface VimeoVideo {
  uri: string;
  name: string;
  description: string | null;
  duration: number;
  width: number;
  height: number;
  created_time: string;
  modified_time: string;
  privacy: { view: string; download: string };
  pictures: { sizes: Array<{ width: number; height: number; link: string }> };
  files?: VimeoFile[];
  download?: VimeoDownload[];
  tags: Array<{ name: string }>;
}

export interface VimeoFolder {
  uri: string;
  name: string;
  created_time: string;
  modified_time: string;
  metadata: { connections: { videos: { uri: string; total: number } } };
}

export interface VimeoPaginatedResponse<T> {
  total: number;
  page: number;
  per_page: number;
  paging: {
    next: string | null;
    previous: string | null;
    first: string;
    last: string;
  };
  data: T[];
}

export interface VimeoConfig {
  accessToken: string;
}
