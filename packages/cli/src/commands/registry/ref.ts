import { qualifyRepository, stripNamespace } from "@/core/bunny-registry.ts";
import { imageHostname } from "@/core/docker.ts";

export interface ParsedImageRef {
  /** Repository path with any host and tag stripped (e.g. `org/app`). */
  name: string;
  /** Tag, defaulting to `latest` when the source omits one. */
  tag: string;
}

/**
 * Split a Docker image reference into its repository name and tag,
 * dropping any leading registry host and any `@digest` suffix (the
 * pushed copy gets its own tag, so the digest can't carry over). The
 * tag is the last `:`-separated segment that falls after the last `/`,
 * so a `host:port` prefix isn't mistaken for a tag.
 */
export function parseImageRef(ref: string): ParsedImageRef {
  const at = ref.indexOf("@");
  if (at !== -1) ref = ref.slice(0, at);

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
  /** Full pushable reference, including the account namespace. */
  reference: string;
  /** Namespaced repository path as stored on the registry. */
  repository: string;
  /** Repository name without the account namespace, for display. */
  displayRepository: string;
  tag: string;
}

/**
 * Build the fully-qualified target reference for pushing `source` to the
 * registry `host`. Repository and tag default to the source image's, and
 * either can be overridden explicitly. The account `namespace` is added
 * to the repository path (the registry requires it) but kept out of
 * `displayRepository` so user-facing output stays clean.
 */
export function buildTargetRef(
  host: string,
  namespace: string,
  source: string,
  repository?: string,
  tag?: string,
): TargetRef {
  const parsed = parseImageRef(source);
  const repo = qualifyRepository(repository ?? parsed.name, namespace);
  const finalTag = tag ?? parsed.tag;
  return {
    reference: `${host}/${repo}:${finalTag}`,
    repository: repo,
    displayRepository: stripNamespace(repo, namespace),
    tag: finalTag,
  };
}
