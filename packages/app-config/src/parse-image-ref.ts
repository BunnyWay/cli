/** Parse a Docker image reference into its components. */
export function parseImageRef(ref: string): {
  imageName: string;
  imageNamespace: string;
  imageTag: string;
} {
  if (!ref) {
    return { imageName: "", imageNamespace: "", imageTag: "" };
  }

  let tag = "latest";
  let imagePath = ref;

  const colonIdx = ref.lastIndexOf(":");
  if (colonIdx > 0 && !ref.substring(colonIdx).includes("/")) {
    tag = ref.substring(colonIdx + 1);
    imagePath = ref.substring(0, colonIdx);
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

  return { imageName: name, imageNamespace: namespace, imageTag: tag };
}
