import {
  DEFAULT_PRESIGNED_URL_TTL_SECONDS,
  MAX_PRESIGNED_URL_TTL_SECONDS,
  MIN_PRESIGNED_URL_TTL_SECONDS,
  type SourceContext,
  type SourcePlugin,
} from "@bunny.net/stream-import";
import { z } from "zod";
import { S3SourceAdapter } from "./adapter.ts";
import { S3SourceClient } from "./client.ts";
import type { S3Config } from "./types.ts";
import { validateAwsRegion, validateS3BucketName } from "./validate.ts";

export const s3ConfigSchema = z.object({
  region: z.string().refine(validateAwsRegion, "Not a valid AWS region"),
  bucket: z.string().refine(validateS3BucketName, "Not a valid S3 bucket name"),
  prefix: z.string().optional(),
  // Credentials are optional: omitting them uses the AWS default chain, which is how this runs on instance roles.
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  sessionToken: z.string().optional(),
  endpoint: z.url().optional(),
  presignedUrlTtl: z
    .number()
    .int()
    .min(MIN_PRESIGNED_URL_TTL_SECONDS)
    .max(MAX_PRESIGNED_URL_TTL_SECONDS)
    .optional(),
});

export const s3Source: SourcePlugin<S3Config> = {
  id: "s3",
  label: "AWS S3",
  dedupTag: "s3Source",
  supportsFolders: true,
  credentials: [
    {
      key: "region",
      label: "AWS Region",
      env: "AWS_REGION",
      fallbackEnv: ["AWS_DEFAULT_REGION"],
      secret: false,
      required: true,
      default: "us-east-1",
    },
    {
      key: "bucket",
      label: "S3 Bucket",
      env: "S3_BUCKET",
      secret: false,
      required: true,
    },
    {
      key: "prefix",
      label: "S3 Prefix",
      env: "S3_PREFIX",
      secret: false,
      required: false,
    },
    {
      key: "accessKeyId",
      label: "AWS Access Key ID",
      env: "AWS_ACCESS_KEY_ID",
      secret: true,
      required: false,
      hint: "Leave blank to use the default AWS credential chain",
    },
    {
      key: "secretAccessKey",
      label: "AWS Secret Access Key",
      env: "AWS_SECRET_ACCESS_KEY",
      secret: true,
      required: false,
    },
    {
      key: "sessionToken",
      label: "AWS Session Token",
      env: "AWS_SESSION_TOKEN",
      secret: true,
      required: false,
    },
    {
      key: "presignedUrlTtl",
      label: "Pre-signed URL TTL (seconds)",
      env: "S3_PRESIGNED_URL_TTL",
      secret: false,
      required: false,
      type: "number",
      default: DEFAULT_PRESIGNED_URL_TTL_SECONDS,
    },
  ],
  configSchema: s3ConfigSchema,
  createAdapter: (config: S3Config, ctx: SourceContext) =>
    new S3SourceAdapter(new S3SourceClient(config, ctx), config),
};
