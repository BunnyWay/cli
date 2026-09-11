export interface S3Object {
  key: string;
  bucket: string;
  size: number;
  etag: string;
  lastModified: string;
  storageClass?: string;
  contentType?: string;
  userMetadata?: Record<string, string>;
}

export interface S3Folder {
  id: string;
  name: string;
  prefix: string;
  videoCount: number;
}

export interface S3Config {
  region: string;
  bucket: string;
  prefix?: string;
  /** Omit both keys to use the AWS SDK's default credential chain. */
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** For S3-compatible providers. */
  endpoint?: string;
  presignedUrlTtl?: number;
}
