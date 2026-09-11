import { describe, expect, test } from "bun:test";
import {
  extractVideoNameFromKey,
  fromSourceId,
  idToPrefix,
  isVideoKey,
  normalizePrefix,
  prefixToId,
  toSourceId,
} from "./keys.ts";
import { s3ConfigSchema } from "./plugin.ts";
import {
  validateAwsRegion,
  validateS3BucketName,
  validateS3Key,
  validateS3Url,
} from "./validate.ts";

describe("keys", () => {
  test("prefixes normalize to a single trailing slash and round-trip through folder ids", () => {
    expect(normalizePrefix("")).toBe("");
    expect(normalizePrefix("/videos/2024")).toBe("videos/2024/");
    const root = normalizePrefix("media");
    const id = prefixToId("media/Q1 2024.final/", root);
    expect(id).toBe("Q1 2024.final");
    expect(idToPrefix(id, root)).toBe("media/Q1 2024.final/");
    expect(prefixToId("other/2024/", "videos/")).toBe("other/2024");
  });

  test("source ids round-trip keys containing slashes", () => {
    const id = toSourceId("my-bucket", "videos/2024/promo.mp4");
    expect(fromSourceId(id)).toEqual({
      bucket: "my-bucket",
      key: "videos/2024/promo.mp4",
    });
    expect(fromSourceId("just-a-bucket")).toEqual({
      bucket: "just-a-bucket",
      key: "",
    });
  });

  test("only keys with a video extension count, and names drop the path and extension", () => {
    expect(isVideoKey("a/b/clip.mp4")).toBe(true);
    expect(isVideoKey("CLIP.MOV")).toBe(true);
    expect(isVideoKey("notes.txt")).toBe(false);
    expect(isVideoKey("videos/")).toBe(false);
    expect(isVideoKey("v1.0/clip")).toBe(false);
    expect(isVideoKey(undefined)).toBe(false);
    expect(extractVideoNameFromKey("a/promo.v2.final.mp4")).toBe(
      "promo.v2.final",
    );
    expect(extractVideoNameFromKey("a/.hidden")).toBe(".hidden");
  });
});

describe("validation", () => {
  test("bucket names follow the AWS rules", () => {
    expect(validateS3BucketName("my.bucket.name")).toBe(true);
    for (const bad of [
      "ab",
      "a".repeat(64),
      "MyBucket",
      "my_bucket",
      "-bucket",
      "my..bucket",
      "my.-bucket",
      "192.168.1.1",
    ]) {
      expect(validateS3BucketName(bad), bad).toBe(false);
    }
  });

  test("keys reject control characters; regions must match the AWS shape", () => {
    expect(validateS3Key("videos/2024/promo.mp4")).toBe(true);
    expect(validateS3Key("videos/\u0000evil.mp4")).toBe(false);
    expect(validateS3Key("videos/\u001B[31mred.mp4")).toBe(false);
    expect(validateS3Key("a".repeat(1025))).toBe(false);
    expect(validateAwsRegion("us-gov-west-1")).toBe(true);
    expect(validateAwsRegion("cn-north-1")).toBe(true);
    expect(validateAwsRegion("US-EAST-1")).toBe(false);
  });

  test("static credentials are all or nothing", () => {
    const base = { region: "us-east-1", bucket: "my-bucket" };
    expect(s3ConfigSchema.safeParse(base).success).toBe(true);
    expect(
      s3ConfigSchema.safeParse({
        ...base,
        accessKeyId: "AKIA",
        secretAccessKey: "s",
      }).success,
    ).toBe(true);
    const half = s3ConfigSchema.safeParse({ ...base, accessKeyId: "AKIA" });
    expect(half.success).toBe(false);
    expect(half.error?.issues[0]?.path).toEqual(["secretAccessKey"]);
    expect(
      s3ConfigSchema.safeParse({ ...base, sessionToken: "tok" }).success,
    ).toBe(false);
  });

  test("with a custom endpoint, download URLs must be on that host instead of AWS", () => {
    const sig = "X-Amz-Signature=abc&X-Amz-Credential=def";
    const endpoint = "https://minio.example.com";
    expect(
      validateS3Url(`https://minio.example.com/bucket/k.mp4?${sig}`, endpoint),
    ).toBe(true);
    expect(
      validateS3Url(`https://bucket.minio.example.com/k.mp4?${sig}`, endpoint),
    ).toBe(true);
    expect(
      validateS3Url(
        `https://my-bucket.s3.amazonaws.com/k.mp4?${sig}`,
        endpoint,
      ),
    ).toBe(false);
    expect(validateS3Url(`https://minio.example.com/bucket/k.mp4?${sig}`)).toBe(
      false,
    );
  });

  test("download URLs must be signed, HTTPS, and on a real AWS S3 host", () => {
    const sig = "X-Amz-Signature=abc&X-Amz-Credential=def";
    for (const host of [
      "my-bucket.s3.amazonaws.com",
      "my-bucket.s3.eu-west-1.amazonaws.com",
      "s3.us-east-2.amazonaws.com",
      "my-bucket.s3-accelerate.amazonaws.com",
      "my-bucket.s3.cn-north-1.amazonaws.com.cn",
    ]) {
      expect(validateS3Url(`https://${host}/key.mp4?${sig}`), host).toBe(true);
    }
    expect(
      validateS3Url(
        "https://b.s3.amazonaws.com/k.mp4?Signature=x&AWSAccessKeyId=y",
      ),
    ).toBe(true);

    expect(validateS3Url("https://my-bucket.s3.amazonaws.com/key.mp4")).toBe(
      false,
    );
    expect(
      validateS3Url("https://b.s3.amazonaws.com/k.mp4?X-Amz-Signature=abc"),
    ).toBe(false);
    expect(
      validateS3Url(`https://s3.amazonaws.com.evil.com/k.mp4?${sig}`),
    ).toBe(false);
    expect(
      validateS3Url(
        `https://my-bucket.s3.amazonaws.com@attacker.example.com/k.mp4?${sig}`,
      ),
    ).toBe(false);
    expect(
      validateS3Url(`http://my-bucket.s3.amazonaws.com/key.mp4?${sig}`),
    ).toBe(false);
    expect(validateS3Url("not a url")).toBe(false);
  });
});
