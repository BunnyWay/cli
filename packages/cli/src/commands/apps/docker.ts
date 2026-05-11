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
 * Build a Docker image from a Dockerfile.
 */
export async function buildImage(
  dockerfile: string,
  tag: string,
  cwd?: string,
): Promise<void> {
  const args = ["docker", "build", "-f", dockerfile, "-t", tag, "."];

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
    throw new UserError(
      `Docker push failed (exit code ${exitCode}).`,
      "Ensure you are logged in to the registry (`docker login <hostname>`).",
    );
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

// ─── Image ref helpers ───────────────────────────────────────────────

/**
 * Extract the registry hostname from a Docker image reference.
 *
 * Returns null if the reference has no explicit hostname (i.e. it's a
 * Docker Hub library or user image like `nginx:latest` or `library/redis`).
 */
export function imageHostname(ref: string): string | null {
  const firstSegment = ref.split("/")[0];
  if (!firstSegment) return null;
  // A hostname segment must contain a dot, a colon (port), or be "localhost".
  if (
    firstSegment.includes(".") ||
    firstSegment.includes(":") ||
    firstSegment === "localhost"
  ) {
    return firstSegment;
  }
  return null;
}

// ─── Registry resolution ─────────────────────────────────────────────

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

// ─── Config suggestions ──────────────────────────────────────────────

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
