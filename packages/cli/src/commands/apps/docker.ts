import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { createMcClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";

export type McClient = ReturnType<typeof createMcClient>;
export type ContainerRegistry = components["schemas"]["ContainerRegistry"];
export type ConfigSuggestions =
  components["schemas"]["ContainerConfigSuggestions"];

/**
 * Ensure the Docker CLI is available on the system.
 */
export async function ensureDockerAvailable(): Promise<void> {
  const proc = Bun.spawn(
    ["docker", "version", "--format", "{{.Client.Version}}"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new UserError(
      "Docker is not installed or not running.",
      "Install Docker from https://docs.docker.com/get-docker/",
    );
  }
}

/**
 * Get a short git SHA for tagging images.
 * Returns the first 7 characters of HEAD, or null if not in a git repo.
 */
export async function gitShortSHA(): Promise<string | null> {
  const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) return null;

  const output = await new Response(proc.stdout).text();
  return output.trim() || null;
}

/**
 * Generate a default image tag from git SHA and timestamp.
 * Format: <sha>-<unix-seconds>  (e.g. a1b2c3d-1709312000)
 */
export async function generateTag(): Promise<string> {
  const sha = await gitShortSHA();
  const ts = Math.floor(Date.now() / 1000);
  return sha ? `${sha}-${ts}` : `${ts}`;
}

/**
 * Extract container ports from `EXPOSE` directives in a Dockerfile.
 *
 * Handles each documented form:
 *   EXPOSE 8080
 *   EXPOSE 8080 443
 *   EXPOSE 8080/tcp
 *   EXPOSE 80/udp        (skipped - bunny CDN/Anycast endpoints are TCP)
 *
 * Returns a deduped list in source order. Pure string parsing - no I/O -
 * so it's trivially testable without a Dockerfile on disk.
 */
export function parseDockerfileExposedPorts(content: string): number[] {
  const ports: number[] = [];
  const seen = new Set<number>();
  for (const rawLine of content.split("\n")) {
    // Strip inline comments and trim. Dockerfile comments start with `#`
    // and run to end of line; they're not valid mid-instruction in real
    // Dockerfiles, but stripping is harmless for the EXPOSE-line case.
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^EXPOSE\s+(.+)$/i);
    if (!match?.[1]) continue;
    for (const token of match[1].trim().split(/\s+/)) {
      const [portStr, proto] = token.split("/");
      if (proto && proto.toLowerCase() !== "tcp") continue;
      const port = Number(portStr);
      if (!Number.isInteger(port) || port <= 0 || port >= 65536) continue;
      if (seen.has(port)) continue;
      seen.add(port);
      ports.push(port);
    }
  }
  return ports;
}

/**
 * Read a Dockerfile from disk and return its EXPOSE'd ports. Returns
 * an empty list when the file doesn't exist or can't be read - callers
 * treat "no exposed ports" the same as "couldn't determine ports".
 */
export async function readDockerfileExposedPorts(
  dockerfilePath: string,
): Promise<number[]> {
  try {
    const content = await Bun.file(dockerfilePath).text();
    return parseDockerfileExposedPorts(content);
  } catch {
    return [];
  }
}

/**
 * Magic Containers only supports `linux/amd64` images. On arm64 hosts
 * (any Apple Silicon Mac) Docker's default build target is the host arch,
 * which silently breaks pulls on MC's side with a generic 500. Hard-coded
 * here rather than configurable because it's a platform requirement, not
 * a per-app choice.
 */
const MC_TARGET_PLATFORM = "linux/amd64";

/**
 * Build a Docker image from a Dockerfile, targeting `linux/amd64` so the
 * resulting image is actually deployable to Magic Containers.
 */
export async function buildImage(
  dockerfile: string,
  tag: string,
  cwd?: string,
): Promise<void> {
  const args = [
    "docker",
    "build",
    "--platform",
    MC_TARGET_PLATFORM,
    "-f",
    dockerfile,
    "-t",
    tag,
    ".",
  ];

  const proc = Bun.spawn(args, {
    cwd: cwd ?? process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new UserError(
      `Docker build failed (exit code ${exitCode}).`,
      "Check the Dockerfile and build output above for errors.",
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

/**
 * Check `~/.docker/config.json` for an existing credential record for
 * `hostname`. Looks at both the `auths` map (where Docker Desktop leaves
 * a `{}` marker even when the real cred lives in a credsStore) and the
 * `credHelpers` map (per-host helpers).
 *
 * Not a guarantee the cred is still valid (tokens expire), but a
 * strong signal that `docker login` has been run here.
 *
 * Takes an optional `configPath` to make the function testable.
 */
export function dockerHasCredentials(
  hostname: string,
  configPath?: string,
): boolean {
  const path = configPath ?? join(homedir(), ".docker", "config.json");
  if (!existsSync(path)) return false;
  try {
    const config = JSON.parse(readFileSync(path, "utf-8")) as {
      auths?: Record<string, unknown>;
      credHelpers?: Record<string, string>;
    };
    if (config.auths && hostname in config.auths) return true;
    if (config.credHelpers && hostname in config.credHelpers) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Check whether `gh` is on PATH and the user is authenticated.
 * Used to offer a one-click docker-login flow for ghcr.io.
 */
export async function ghIsAuthenticated(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["gh", "auth", "status"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/**
 * Parse the `X-Oauth-Scopes` response header from `gh api user -i` output.
 *
 * GitHub returns the active scopes for the token on every authenticated
 * request, which is the only reliable way to verify scopes - `gh auth
 * status` reads cached/configured scopes, not what the token actually
 * carries server-side.
 *
 * Returns `[]` if the header is absent (older gh, or no auth).
 */
export function parseOauthScopes(headerOutput: string): string[] {
  const match = headerOutput.match(/^X-Oauth-Scopes:\s*(.+)$/im);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Fetch the OAuth scopes attached to the current `gh` token, as reported
 * by GitHub. Returns `[]` if `gh` is unauthenticated or the call fails.
 */
export async function ghTokenScopes(): Promise<string[]> {
  const proc = Bun.spawn(["gh", "api", "user", "-i"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) return [];
  const out = await new Response(proc.stdout).text();
  return parseOauthScopes(out);
}

/**
 * Ensure the local `gh` token has `write:packages` scope before we hand it
 * to `docker login`. Without this scope, login succeeds but `docker push`
 * fails with `permission_denied: write_package`, which is confusing
 * because the failure happens minutes later, after a full image build.
 *
 * If the scope is missing, offer to run `gh auth refresh` interactively.
 * The user has to complete the browser flow themselves; we just kick it off.
 */
export async function ghEnsureWritePackagesScope(): Promise<void> {
  const scopes = await ghTokenScopes();
  if (scopes.includes("write:packages")) return;

  logger.warn(
    "Your GitHub CLI token is missing the `write:packages` scope, which ghcr.io requires for pushes.",
  );

  const { value } = await prompts({
    type: "confirm",
    name: "value",
    message: "Run `gh auth refresh -h github.com -s write:packages` to add it?",
    initial: true,
  });

  if (!value) {
    throw new UserError(
      "`write:packages` scope is required to push to ghcr.io.",
      "Run `gh auth refresh -h github.com -s write:packages` and try again.",
    );
  }

  const proc = Bun.spawn(
    ["gh", "auth", "refresh", "-h", "github.com", "-s", "write:packages"],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  if ((await proc.exited) !== 0) {
    throw new UserError(
      "`gh auth refresh` failed.",
      "Run `gh auth refresh -h github.com -s write:packages` manually and try again.",
    );
  }
}

/**
 * Log in to a registry using the local `gh` CLI for credentials.
 *
 * The user is already authenticated to GitHub, so we read their username
 * and token via `gh api user` / `gh auth token`, then pipe them through
 * the normal `docker login` flow. Token never touches stdout/stderr.
 */
export async function ghDockerLogin(hostname: string): Promise<void> {
  if (hostname === "ghcr.io") {
    await ghEnsureWritePackagesScope();
  }

  const userProc = Bun.spawn(["gh", "api", "user", "--jq", ".login"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await userProc.exited) !== 0) {
    throw new UserError(
      "`gh api user` failed.",
      "Ensure the GitHub CLI is authenticated (`gh auth status`).",
    );
  }
  const username = (await new Response(userProc.stdout).text()).trim();

  const tokenProc = Bun.spawn(["gh", "auth", "token"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await tokenProc.exited) !== 0) {
    throw new UserError("`gh auth token` failed.");
  }
  const token = (await new Response(tokenProc.stdout).text()).trim();

  await dockerLogin(hostname, username, token);
}

/**
 * Ensure docker is logged in to `hostname` before a push. If not, offer
 * a login flow:
 *
 * - `ghcr.io` + `gh` authenticated → one-click via GitHub CLI
 * - any host → fall back to manual username / password prompts
 *
 * On success, credentials persist in `~/.docker/config.json` so future
 * deploys skip this step.
 */
export async function ensureRegistryLogin(hostname: string): Promise<void> {
  if (dockerHasCredentials(hostname)) return;

  logger.warn(`Not logged in to ${hostname}.`);

  if (hostname === "ghcr.io" && (await ghIsAuthenticated())) {
    const { value } = await prompts({
      type: "confirm",
      name: "value",
      message: "Use the GitHub CLI (`gh`) to log in to ghcr.io?",
      initial: true,
    });
    if (value) {
      const spin = spinner("Logging in via gh...");
      spin.start();
      try {
        await ghDockerLogin(hostname);
        spin.stop();
        logger.success(`Logged in to ${hostname}.`);
        return;
      } catch (err) {
        spin.stop();
        throw err;
      }
    }
  }

  const { value: username } = await prompts({
    type: "text",
    name: "value",
    message: `Username for ${hostname}:`,
  });
  if (!username) throw new UserError(`Login to ${hostname} required.`);

  const { value: password } = await prompts({
    type: "password",
    name: "value",
    message: `Password/Token for ${hostname}:`,
  });
  if (!password) throw new UserError(`Login to ${hostname} required.`);

  const spin = spinner(`Logging in to ${hostname}...`);
  spin.start();
  try {
    await dockerLogin(hostname, username, password);
    spin.stop();
    logger.success(`Logged in to ${hostname}.`);
  } catch (err) {
    spin.stop();
    throw err;
  }
}

/**
 * Build a fully-qualified image ref for pushing to a registry.
 *
 * Most registries (ghcr.io, Docker Hub) require the namespace segment -
 * `host/<owner>/<image>:tag`. Without it, ghcr.io interprets the first
 * segment as the owner and rejects the blob upload with 400 Bad Request.
 *
 * `userName` from the registry record is the namespace for the user's
 * own pushes. When it's missing (public registry, or self-hosted setup
 * that doesn't need a namespace), fall back to `host/image:tag`.
 *
 * Both the namespace and the image name are lowercased because GHCR and
 * Docker Hub reject mixed-case path segments.
 */
export function buildImageRef(
  hostName: string,
  userName: string | null | undefined,
  imageName: string,
  tag: string,
): string {
  const ns = userName?.trim().toLowerCase();
  const name = imageName.toLowerCase();
  return ns ? `${hostName}/${ns}/${name}:${tag}` : `${hostName}/${name}:${tag}`;
}

/**
 * Extract the registry hostname from a Docker image reference.
 *
 * Returns null if the reference has no explicit hostname (i.e. it's a
 * Docker Hub library or user image like `nginx:latest` or `library/redis`).
 *
 * A hostname only exists when the ref has a `/`. Otherwise the first
 * segment is just `name[:tag]`, not `host[:port]`. Without that check,
 * `nginx:1.27` would be mis-read as the hostname `nginx:1.27`.
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

const ADD_NEW_REGISTRY = "__add_new__";

/**
 * Result of resolving a registry — the ID plus, if the user just entered
 * credentials in this session, those credentials so the caller can run
 * `docker login` without prompting again.
 */
export interface ResolvedRegistry {
  id: string;
  hostName?: string;
  freshCredentials?: { userName: string; password: string };
}

/**
 * Fetch all registries on the account.
 */
export async function listRegistries(
  client: McClient,
): Promise<ContainerRegistry[]> {
  const { data } = await client.GET("/registries");
  return data?.items ?? [];
}

/**
 * Find an existing registry that matches the given hostname.
 * Falls back to undefined if no match is found.
 */
export function findRegistryByHostname(
  registries: ContainerRegistry[],
  hostname: string,
): ContainerRegistry | undefined {
  const normalized = hostname.toLowerCase();
  return registries.find((r) => r.hostName?.toLowerCase() === normalized);
}

/**
 * Inline "add new registry" flow. Prompts for display name + credentials,
 * creates the registry on bunny.net, and returns its ID along with the
 * credentials so the caller can `docker login` without re-prompting.
 *
 * If `hostname` is given it is used as the suggested display name.
 *
 * If `isPublic` is true, the registry is created with no credentials
 * (suitable for pulling public images that don't require auth).
 */
export async function createRegistry(
  client: McClient,
  opts: { displayName?: string; isPublic?: boolean } = {},
): Promise<ResolvedRegistry | null> {
  let displayName = opts.displayName;
  if (!displayName) {
    const { value } = await prompts({
      type: "text",
      name: "value",
      message: "Registry display name:",
    });
    displayName = value;
  }
  if (!displayName) return null;

  let userName: string | undefined;
  let password: string | undefined;

  if (!opts.isPublic) {
    const { value: rawUser } = await prompts({
      type: "text",
      name: "value",
      message: "Username:",
    });
    userName = rawUser;
    if (!userName) return null;

    const { value: rawPass } = await prompts({
      type: "password",
      name: "value",
      message: "Password/Token:",
    });
    password = rawPass;
    if (!password) return null;
  }

  const addSpin = spinner("Adding registry...");
  addSpin.start();

  const { data: result } = await client.POST("/registries", {
    body: {
      displayName,
      ...(userName && password
        ? { passwordCredentials: { userName, password } }
        : {}),
    },
  });

  addSpin.stop();

  if (result?.status !== "saved" || !result.id) {
    logger.error(`Failed to add registry: ${result?.error ?? "unknown error"}`);
    return null;
  }

  logger.success(`Registry "${displayName}" added (ID: ${result.id}).`);

  return {
    id: String(result.id),
    freshCredentials: userName && password ? { userName, password } : undefined,
  };
}

/**
 * Interactive registry selection for "where do I push my image?".
 * Returns the registry ID, or null if cancelled.
 */
export async function promptRegistry(
  client: McClient,
): Promise<ResolvedRegistry | null> {
  const regSpin = spinner("Fetching registries...");
  regSpin.start();

  const registries = await listRegistries(client);

  regSpin.stop();

  // Only show registries the user can push to (have a username).
  const pushable = registries.filter((r) => r.userName);

  const choices = [
    ...pushable.map((r) => ({
      title: `${r.displayName} (${r.hostName} — ${r.userName})`,
      value: String(r.id ?? ""),
    })),
    { title: "Add new registry", value: ADD_NEW_REGISTRY },
  ];

  const { value: choice } = await prompts({
    type: "select",
    name: "value",
    message: "Container registry:",
    choices,
  });

  if (choice === undefined) return null;
  if (choice !== ADD_NEW_REGISTRY) {
    const existing = pushable.find((r) => String(r.id) === String(choice));
    return { id: String(choice), hostName: existing?.hostName };
  }

  return createRegistry(client);
}

/**
 * Resolve a registry to use when pulling an image. If the hostname matches
 * an existing registry, returns it. Otherwise prompts the user to either
 * add it as a public registry or provide credentials.
 *
 * Returns null if the user cancels.
 */
export async function resolveRegistryForImage(
  client: McClient,
  imageRef: string,
): Promise<ResolvedRegistry | null> {
  const hostname = imageHostname(imageRef) ?? "docker.io";

  const fetchSpin = spinner("Looking up registry...");
  fetchSpin.start();
  const registries = await listRegistries(client);
  fetchSpin.stop();

  const existing = findRegistryByHostname(registries, hostname);
  if (existing?.id) {
    return { id: String(existing.id), hostName: existing.hostName };
  }

  logger.info(`No registry connected for ${hostname}.`);

  const { value: kind } = await prompts({
    type: "select",
    name: "value",
    message: `Is ${hostname} public, or do you need credentials?`,
    choices: [
      { title: "Public — no credentials needed", value: "public" },
      { title: "Private — I have credentials", value: "private" },
      { title: "Cancel", value: "cancel" },
    ],
  });

  if (!kind || kind === "cancel") return null;

  return createRegistry(client, {
    displayName: hostname,
    isPublic: kind === "public",
  });
}

/**
 * Ask bunny.net for recommended configuration for a given image
 * (endpoints, environment variables, app name suggestion). Returns null
 * if no suggestions are available — common for custom user images.
 */
export async function getConfigSuggestions(
  client: McClient,
  registryId: string,
  imageRef: { imageName: string; imageNamespace: string; imageTag: string },
): Promise<ConfigSuggestions | null> {
  const spin = spinner("Looking up image defaults...");
  spin.start();

  const { data, error } = await client.POST("/registries/config-suggestions", {
    body: {
      registryId,
      imageName: imageRef.imageName,
      imageNamespace: imageRef.imageNamespace,
      tag: imageRef.imageTag,
    },
  });

  spin.stop();

  if (error || !data) return null;
  return data;
}
