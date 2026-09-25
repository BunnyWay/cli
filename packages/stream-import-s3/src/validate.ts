// S3 input guards; `validateS3Url` is the last check before a URL reaches Bunny's fetch endpoint.

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

/** A signed (SigV4 or SigV2) HTTPS URL on an AWS S3 host, or on the custom `endpoint` host when one is set; the README lists the host forms. */
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

  return /^(?:[a-z0-9.-]+\.)?s3(?:-accelerate|-fips)?(?:\.dualstack)?(?:[.-][a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/.test(
    host,
  );
}
