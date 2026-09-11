/**
 * S3 input guards. `validateS3Url` is a security boundary: it is the last check
 * before a URL is handed to Bunny's fetch endpoint, so a misconfigured or
 * hostile source cannot point Bunny at an arbitrary host.
 */

/** https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html */
export function validateS3BucketName(name: string): boolean {
  if (!name || name.length < 3 || name.length > 63) return false;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return false;
  if (name.includes("..")) return false;
  if (/\.-|-\./.test(name)) return false;
  // A bucket name that parses as an IPv4 address is not addressable.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false;

  return true;
}

/** AWS permits almost any key; control characters are rejected because the key is used as a display string and a state-file identifier. */
export function validateS3Key(key: string): boolean {
  if (!key || key.length > 1024) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  return !/[\x00-\x1F\x7F]/.test(key);
}

export function validateAwsRegion(region: string): boolean {
  return /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/.test(region);
}

/**
 * Accepts the AWS S3 endpoint forms:
 *   {bucket}.s3.amazonaws.com                      legacy global
 *   {bucket}.s3.{region}.amazonaws.com             virtual-hosted
 *   s3.amazonaws.com / s3.{region}.amazonaws.com   path style
 *   {bucket}.s3-accelerate.amazonaws.com           Transfer Acceleration
 *   ...and the same under .amazonaws.com.cn        AWS China
 *
 * With a custom `endpoint` (S3-compatible providers) the host must be that
 * endpoint's, bare or with the bucket as a subdomain, instead of an AWS one.
 *
 * The URL must also carry a SigV4 or SigV2 signature: without one Bunny would
 * just get a 403 from a private object.
 */
export function validateS3Url(url: string, endpoint?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  if (!isAllowedS3Host(host, endpoint)) return false;

  const q = parsed.searchParams;
  const sigV4 = q.has("X-Amz-Signature") && q.has("X-Amz-Credential");
  const sigV2 = q.has("Signature") && q.has("AWSAccessKeyId");

  return sigV4 || sigV2;
}

function isAllowedS3Host(host: string, endpoint?: string): boolean {
  if (endpoint) {
    let endpointHost: string;
    try {
      endpointHost = new URL(endpoint).hostname.toLowerCase();
    } catch {
      return false;
    }

    return host === endpointHost || host.endsWith(`.${endpointHost}`);
  }

  return /^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/.test(
    host,
  );
}
