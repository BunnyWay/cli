import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
  type _Object as S3SdkObject,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  DEFAULT_PRESIGNED_URL_TTL_SECONDS,
  MAX_PRESIGNED_URL_TTL_SECONDS,
  MIN_PRESIGNED_URL_TTL_SECONDS,
  type SourceContext,
  UserError,
} from "@bunny.net/stream-import";
import { isVideoKey, normalizePrefix, prefixToId } from "./keys.ts";
import type { S3Config, S3Folder, S3Object } from "./types.ts";
import { validateS3BucketName, validateS3Key } from "./validate.ts";

/** Wraps the AWS SDK: list objects, head object, head bucket, and pre-sign a GET. */
export class S3SourceClient {
  private readonly client: S3Client;
  private readonly defaultTtl: number;

  constructor(config: S3Config, _ctx: SourceContext) {
    // Both keys or neither: a half-set pair would silently fall back to the ambient chain and import from the wrong account.
    const credentials =
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            sessionToken: config.sessionToken,
          }
        : undefined;

    this.client = new S3Client({
      region: config.region,
      credentials,
      endpoint: config.endpoint,
    });

    this.defaultTtl = clampTtl(
      config.presignedUrlTtl ?? DEFAULT_PRESIGNED_URL_TTL_SECONDS,
    );
  }

  async validateCredentials(bucket: string): Promise<void> {
    if (!validateS3BucketName(bucket)) {
      throw new UserError(`Invalid S3 bucket name: ${bucket}`);
    }

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      throw asUserError(error, bucket);
    }
  }

  async getAccountInfo(
    bucket: string,
    prefix: string,
  ): Promise<Record<string, string>> {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizePrefix(prefix) || undefined,
        MaxKeys: 1000,
      }),
    );
    const count = (response.Contents ?? []).filter((o) =>
      isVideoKey(o.Key),
    ).length;

    return {
      Bucket: bucket,
      Prefix: prefix || "(root)",
      // Capped at one page: this is the "Connected" summary line, not accounting.
      "Videos (first 1000 keys)": response.IsTruncated
        ? `${count}+`
        : String(count),
    };
  }

  /** Video objects at or below `prefix`, paginated to completion. */
  async listVideosByPrefix(
    bucket: string,
    prefix: string,
  ): Promise<S3Object[]> {
    const objects: S3Object[] = [];
    let token: string | undefined;

    do {
      const response: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix || undefined,
          ContinuationToken: token,
        }),
      );

      for (const item of response.Contents ?? []) {
        if (isVideoKey(item.Key)) objects.push(toS3Object(item, bucket));
      }
      token = response.NextContinuationToken;
    } while (token);

    return objects;
  }

  /** Folders are `CommonPrefixes` one level below the root, and root-level objects are the uncategorized set. */
  async getAllVideosWithFolders(
    bucket: string,
    rootPrefix: string,
  ): Promise<{
    folders: S3Folder[];
    videos: Map<string, S3Object[]>;
    uncategorizedVideos: S3Object[];
  }> {
    const root = normalizePrefix(rootPrefix);
    const folders: S3Folder[] = [];
    const uncategorizedVideos: S3Object[] = [];
    let token: string | undefined;

    do {
      const response: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: root || undefined,
          Delimiter: "/",
          ContinuationToken: token,
        }),
      );

      for (const cp of response.CommonPrefixes ?? []) {
        if (!cp.Prefix) continue;
        const id = prefixToId(cp.Prefix, root);
        if (id)
          folders.push({ id, name: id, prefix: cp.Prefix, videoCount: 0 });
      }

      for (const item of response.Contents ?? []) {
        if (isVideoKey(item.Key))
          uncategorizedVideos.push(toS3Object(item, bucket));
      }

      token = response.NextContinuationToken;
    } while (token);

    const videos = new Map<string, S3Object[]>();
    for (const folder of folders) {
      const folderVideos = await this.listVideosByPrefix(bucket, folder.prefix);
      videos.set(folder.id, folderVideos);
      folder.videoCount = folderVideos.length;
    }

    return { folders, videos, uncategorizedVideos };
  }

  /** User metadata (`x-amz-meta-*`), for richer titles and descriptions. */
  async headObject(bucket: string, key: string): Promise<S3Object | null> {
    if (!validateS3Key(key)) throw new UserError("Invalid S3 object key");

    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );

      return {
        bucket,
        key,
        size: response.ContentLength ?? 0,
        etag: (response.ETag ?? "").replaceAll('"', ""),
        lastModified: response.LastModified?.toISOString() ?? "",
        storageClass: response.StorageClass,
        contentType: response.ContentType,
        userMetadata: response.Metadata,
      };
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.$metadata?.httpStatusCode === 404 || error.name === "NotFound")
      ) {
        return null;
      }
      throw error;
    }
  }

  /** The URL handed to Bunny's fetch endpoint. */
  async getPresignedDownloadUrl(
    bucket: string,
    key: string,
    ttlSeconds?: number,
  ): Promise<string> {
    if (!validateS3BucketName(bucket))
      throw new UserError(`Invalid S3 bucket name: ${bucket}`);
    if (!validateS3Key(key)) throw new UserError("Invalid S3 object key");

    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      {
        expiresIn: ttlSeconds ? clampTtl(ttlSeconds) : this.defaultTtl,
      },
    );
  }
}

function clampTtl(ttl: number): number {
  return Math.min(
    Math.max(ttl, MIN_PRESIGNED_URL_TTL_SECONDS),
    MAX_PRESIGNED_URL_TTL_SECONDS,
  );
}

function toS3Object(item: S3SdkObject, bucket: string): S3Object {
  return {
    bucket,
    key: item.Key ?? "",
    size: item.Size ?? 0,
    etag: (item.ETag ?? "").replaceAll('"', ""),
    lastModified: item.LastModified?.toISOString() ?? "",
    storageClass: item.StorageClass,
  };
}

/** Turn the SDK's exceptions into messages that say what to do about them. */
function asUserError(error: unknown, bucket: string): unknown {
  if (!(error instanceof S3ServiceException)) return error;

  switch (error.$metadata?.httpStatusCode) {
    case 301:
      return new UserError(
        `Bucket "${bucket}" is in a different region.`,
        "Set AWS_REGION to the bucket's region.",
      );
    case 403:
      return new UserError(
        `Access denied to bucket "${bucket}".`,
        "The credentials need s3:ListBucket and s3:GetObject.",
      );
    case 404:
      return new UserError(`Bucket "${bucket}" not found.`);
    default:
      break;
  }

  if (
    error.name === "CredentialsProviderError" ||
    error.name === "InvalidAccessKeyId"
  ) {
    return new UserError(
      "Invalid AWS credentials.",
      "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure the AWS default credential chain.",
    );
  }

  return error;
}
