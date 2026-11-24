/** Parse a Docker image reference into its components. */
export function parseImageRef(ref: string): {
  imageName: string;
  imageNamespace: string;
  imageTag: string;
  imageDigest?: string;
} {
  if (!ref) {
    return { imageName: "", imageNamespace: "", imageTag: "" };
  }

  const [path = ref, digest] = ref.split("@", 2);

  let tag = "latest";
  let imagePath = path;

  const colonIdx = path.lastIndexOf(":");
  if (colonIdx > 0 && !path.substring(colonIdx).includes("/")) {
    tag = path.substring(colonIdx + 1);
    imagePath = path.substring(0, colonIdx);
  }

  const parts = imagePath.split("/");
  const name = parts.pop() ?? imagePath;

  // Bare names (no slash) refer to Docker Hub's `library` namespace
  // (e.g. `postgres` → `library/postgres`). The MC API rejects empty
  // imageNamespace, so make the convention explicit.
  let namespace: string;
  if (parts.length === 0) {
    namespace = "library";
  } else if (parts.length > 1) {
    namespace = parts.slice(1).join("/");
  } else {
    namespace = parts[0] ?? "";
  }

  return {
    imageName: name,
    imageNamespace: namespace,
    imageTag: tag,
    ...(digest ? { imageDigest: digest } : {}),
  };
}
