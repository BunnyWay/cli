import { UserError } from "./errors.ts";

/**
 * Ensure the Docker CLI is available on the system.
 *
 * Two failure modes need to map to the same friendly error:
 *   - `docker` not on PATH → `Bun.spawn` throws ENOENT synchronously
 *     (unlike Node's child_process, which emits an 'error' event).
 *   - `docker` on PATH but daemon not running / version probe fails →
 *     non-zero exit code.
 */
export async function ensureDockerAvailable(): Promise<void> {
  let exitCode: number;
  try {
    const proc = Bun.spawn(
      ["docker", "version", "--format", "{{.Client.Version}}"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    exitCode = await proc.exited;
  } catch {
    exitCode = 1;
  }

  if (exitCode !== 0) {
    throw new UserError(
      "Docker is not installed or not running.",
      "Install Docker from https://docs.docker.com/get-docker/",
    );
  }
}

/**
 * Extract the registry hostname from a Docker image reference.
 *
 * Returns null if the reference has no explicit hostname (i.e. it's a
 * Docker Hub library or user image like `nginx:latest` or `library/redis`).
 *
 * A hostname only exists when the ref has a `/`. Otherwise the first
 * segment is just `name[:tag]`, not `host[:port]`.
 */
export function imageHostname(ref: string): string | null {
  if (!ref.includes("/")) return null;
  const firstSegment = ref.split("/")[0];
  if (!firstSegment) return null;
  if (
    firstSegment.includes(".") ||
    firstSegment.includes(":") ||
    firstSegment === "localhost"
  ) {
    return firstSegment;
  }
  return null;
}

/**
 * Re-tag a local image under a new reference (`docker tag <source> <target>`).
 */
export async function tagImage(source: string, target: string): Promise<void> {
  const proc = Bun.spawn(["docker", "tag", source, target], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new UserError(
      `Could not tag image "${source}".`,
      stderr.trim() || "Check that the source image exists locally.",
    );
  }
}

/**
 * Push a Docker image to a registry.
 */
export async function pushImage(tag: string): Promise<void> {
  const proc = Bun.spawn(["docker", "push", tag], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const hostname = imageHostname(tag);
    const hint =
      hostname === "ghcr.io"
        ? "If you saw `permission_denied: write_package`, your token is missing the `write:packages` scope. Run `gh auth refresh -h github.com -s write:packages` then `gh auth token | docker login ghcr.io -u $(gh api user --jq .login) --password-stdin` and try again."
        : `Run \`docker login ${hostname ?? "<hostname>"}\` and try again. Check that your token has push permission.`;
    throw new UserError(`Docker push failed (exit code ${exitCode}).`, hint);
  }
}

/**
 * Log in to a Docker registry. Pipes the password through stdin so it
 * never appears in the process list.
 */
export async function dockerLogin(
  hostname: string,
  username: string,
  password: string,
): Promise<void> {
  const proc = Bun.spawn(
    ["docker", "login", hostname, "-u", username, "--password-stdin"],
    {
      stdin: new Response(password),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new UserError(
      "Docker login failed.",
      stderr.trim() || "Check your registry credentials.",
    );
  }
}
