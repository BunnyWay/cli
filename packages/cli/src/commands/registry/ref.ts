import { imageHostname } from "../../core/docker.ts";

export interface ParsedImageRef {
  /** Repository path with any host and tag stripped (e.g. `org/app`). */
  name: string;
  /** Tag, defaulting to `latest` when the source omits one. */
  tag: string;
}

/**
 * Split a Docker image reference into its repository name and tag,
 * dropping any leading registry host. The tag is the last `:`-separated
 * segment that falls after the last `/`, so a `host:port` prefix isn't
 * mistaken for a tag.
 */
export function parseImageRef(ref: string): ParsedImageRef {
  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");

  let nameAndHost = ref;
  let tag = "latest";
  if (lastColon > lastSlash) {
    nameAndHost = ref.slice(0, lastColon);
    tag = ref.slice(lastColon + 1);
  }

  const host = imageHostname(nameAndHost);
  const name = host ? nameAndHost.slice(host.length + 1) : nameAndHost;
  return { name: name.toLowerCase(), tag };
}

export interface TargetRef {
  reference: string;
  repository: string;
  tag: string;
}

/**
 * Build the fully-qualified target reference for pushing `source` to the
 * registry `host`. Repository and tag default to the source image's, and
 * either can be overridden explicitly.
 */
export function buildTargetRef(
  host: string,
  source: string,
  repository?: string,
  tag?: string,
): TargetRef {
  const parsed = parseImageRef(source);
  const repo = (repository ?? parsed.name).toLowerCase();
  const finalTag = tag ?? parsed.tag;
  return {
    reference: `${host}/${repo}:${finalTag}`,
    repository: repo,
    tag: finalTag,
  };
}
