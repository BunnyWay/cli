import prompts from "prompts";
import type { createMcClient } from "../../api/mc-client.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";

export type McClient = ReturnType<typeof createMcClient>;

/**
 * Ensure the Docker CLI is available on the system.
 */
export async function ensureDockerAvailable(): Promise<void> {
  const proc = Bun.spawn(["docker", "version", "--format", "{{.Client.Version}}"], {
    stdout: "pipe",
    stderr: "pipe",
  });
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
      "Ensure you are logged in to the registry (`docker login`).",
    );
  }
}

/**
 * Log in to a Docker registry using credentials from the MC API.
 */
export async function dockerLogin(
  hostname: string,
  username: string,
  password: string,
): Promise<void> {
  const proc = Bun.spawn(
    ["docker", "login", hostname, "-u", username, "--password-stdin"],
    {
      stdin: new Response(password).body!,
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

const ADD_NEW_REGISTRY = "__add_new__";

/**
 * Prompt the user to select a container registry (or add a new one).
 * Returns the registry ID as a string, or null if cancelled.
 */
export async function promptRegistry(
  client: McClient,
): Promise<string | null> {
  const regSpin = spinner("Fetching registries...");
  regSpin.start();

  const { data } = await client.GET("/registries");

  regSpin.stop();

  const registries = data?.items ?? [];

  // Only show registries the user can push to (have a username)
  const pushable = registries.filter((r) => r.userName);

  const choices = [
    ...pushable.map((r) => ({
      title: `${r.displayName} (${r.hostName} — ${r.userName})`,
      value: String(r.id ?? ""),
    })),
    { title: "Add new registry", value: ADD_NEW_REGISTRY },
  ];

  const { value: registryId } = await prompts({
    type: "select",
    name: "value",
    message: "Container registry:",
    choices,
  });

  if (registryId === undefined) return null;

  if (registryId !== ADD_NEW_REGISTRY) return registryId;

  // Inline "add new registry" flow
  const { value: displayName } = await prompts({
    type: "text",
    name: "value",
    message: "Registry display name:",
  });
  if (!displayName) return null;

  const { value: userName } = await prompts({
    type: "text",
    name: "value",
    message: "Username:",
  });
  if (!userName) return null;

  const { value: password } = await prompts({
    type: "password",
    name: "value",
    message: "Password/Token:",
  });
  if (!password) return null;

  const addSpin = spinner("Adding registry...");
  addSpin.start();

  const { data: result } = await client.POST("/registries", {
    body: {
      displayName,
      passwordCredentials: { userName, password },
    },
  });

  addSpin.stop();

  if (result?.status !== "Saved" || !result.id) {
    logger.error(`Failed to add registry: ${result?.error ?? "unknown error"}`);
    return null;
  }

  logger.success(`Registry "${displayName}" added (ID: ${result.id}).`);
  return String(result.id);
}
