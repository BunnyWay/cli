/** Parse a Docker image reference into its components. */
export function parseImageRef(ref: string): {
  imageName: string;
  imageNamespace: string;
  imageTag: string;
} {
  let tag = "latest";
  let imagePath = ref;

  const colonIdx = ref.lastIndexOf(":");
  if (colonIdx > 0 && !ref.substring(colonIdx).includes("/")) {
    tag = ref.substring(colonIdx + 1);
    imagePath = ref.substring(0, colonIdx);
  }

  const parts = imagePath.split("/");
  const name = parts.pop() ?? imagePath;
  const namespace =
    parts.length > 1 ? parts.slice(1).join("/") : (parts[0] ?? "");

  return { imageName: name, imageNamespace: namespace, imageTag: tag };
}
