import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import prompts from "prompts";
import { logger } from "../../../core/logger.ts";
import type { BunnyAppConfig, ContainerConfig } from "../config.ts";
import { parseDotenv } from "./parse.ts";

/** How many orphan key names we name inline before collapsing to a count. */
const ORPHAN_PREVIEW = 5;

/**
 * Env keys a container already accounts for.
 *
 * Both sides of the map count: `"DATABASE_URL": "PROD_DATABASE_URL"` claims
 * `DATABASE_URL` (it's set on the container) *and* `PROD_DATABASE_URL` (it's
 * the `.env` key feeding it), so neither should be offered again.
 */
export function claimedEnvKeys(container: ContainerConfig): Set<string> {
  const claimed = new Set<string>();
  for (const [key, value] of Object.entries(container.env ?? {})) {
    claimed.add(key);
    claimed.add(value);
  }
  return claimed;
}

/** `.env` keys this container neither declares nor has previously declined. */
export function unclaimedEnvKeys(
  dotenvKeys: string[],
  container: ContainerConfig,
  declined: string[] = [],
): string[] {
  const claimed = claimedEnvKeys(container);
  const ignored = new Set(declined);
  return dotenvKeys
    .filter((key) => !claimed.has(key) && !ignored.has(key))
    .sort();
}

/**
 * Which container a `.env` reconcile should attach keys to.
 *
 * Only an unambiguous target qualifies: an explicit `--container` (matched
 * case-insensitively, same as `resolveTargetContainer`) or a config with
 * exactly one container. With several containers and no flag there's no
 * defensible guess - a `DATABASE_URL` could belong to either side of an
 * app/postgres pair.
 */
export function reconcileTarget(
  toml: BunnyAppConfig,
  explicit?: string,
): string | undefined {
  const names = Object.keys(toml.app.containers);
  if (explicit) {
    return names.find((n) => n.toLowerCase() === explicit.toLowerCase());
  }
  return names.length === 1 ? names[0] : undefined;
}

/** `.env` keys that no container in the config accounts for. */
export function orphanEnvKeys(
  dotenvKeys: string[],
  toml: BunnyAppConfig,
): string[] {
  const containers = Object.values(toml.app.containers);
  return dotenvKeys.filter((key) =>
    containers.every((c) => !claimedEnvKeys(c).has(key)),
  );
}

/**
 * Offer any `.env` keys the target container doesn't already set, and add
 * the accepted ones to `bunny.jsonc` as self-pointers (`KEY: KEY`).
 *
 * This is the redeploy counterpart to the first-run walkthrough's env
 * picker: once `bunny.jsonc` exists, a key added to `.env` afterwards is
 * invisible to deploy, because {@link resolveContainerEnv} only ever
 * *resolves* keys the config already declares. Writing pointers keeps the
 * values in `.env` and out of the committed config.
 *
 * Declined keys are reported to `onDeclined` so the caller can persist them
 * and stop re-asking on every deploy. A cancelled prompt records nothing.
 *
 * Returns `true` when the config was mutated and needs saving.
 */
export async function reconcileDotenv(
  toml: BunnyAppConfig,
  dotenvPath: string,
  opts: {
    explicitContainer?: string;
    declinedFor: (container: string) => string[];
    onDeclined: (container: string, keys: string[]) => void;
  },
): Promise<boolean> {
  if (!existsSync(dotenvPath)) return false;

  let dotenvKeys: string[];
  try {
    dotenvKeys = Object.keys(parseDotenv(readFileSync(dotenvPath, "utf-8")));
  } catch {
    // Unreadable `.env` - not worth failing a deploy over.
    return false;
  }
  if (dotenvKeys.length === 0) return false;

  const target = reconcileTarget(toml, opts.explicitContainer);
  if (!target) {
    reportOrphans(orphanEnvKeys(dotenvKeys, toml), dotenvPath);
    return false;
  }

  const container = toml.app.containers[target];
  if (!container) return false;

  const candidates = unclaimedEnvKeys(
    dotenvKeys,
    container,
    opts.declinedFor(target),
  );
  if (candidates.length === 0) return false;

  logger.log();
  logger.dim(
    `Only key names are written to bunny.jsonc; values are read from ${basename(dotenvPath)} at deploy time.`,
  );

  let cancelled = false;
  const { picked } = await prompts(
    {
      type: "multiselect",
      name: "picked",
      message: `Set these ${basename(dotenvPath)} keys on "${target}"?`,
      choices: candidates.map((key) => ({
        title: key,
        value: key,
        selected: true,
      })),
      hint: "space to toggle, enter to confirm",
      instructions: false,
    },
    { onCancel: () => (cancelled = true) },
  );
  // Ctrl-C leaves `picked` empty, which is indistinguishable from
  // "deselected everything" - bail before we record the whole list as
  // declined and silence it forever.
  if (cancelled) return false;

  const accepted = Array.isArray(picked)
    ? picked.filter((k): k is string => typeof k === "string")
    : [];

  const declined = candidates.filter((key) => !accepted.includes(key));
  if (declined.length > 0) opts.onDeclined(target, declined);

  if (accepted.length === 0) return false;

  container.env = { ...(container.env ?? {}) };
  for (const key of accepted) container.env[key] = key;

  logger.success(
    `Added ${accepted.length} env key${accepted.length === 1 ? "" : "s"} to "${target}" in bunny.jsonc.`,
  );
  return true;
}

/**
 * Multi-container configs get a nudge instead of a prompt - we can't pick a
 * container for them, but silently ignoring a `.env` full of unused keys
 * reads as "nothing to do here" when there is.
 */
function reportOrphans(orphans: string[], dotenvPath: string): void {
  if (orphans.length === 0) return;

  const preview = orphans.slice(0, ORPHAN_PREVIEW).join(", ");
  const more =
    orphans.length > ORPHAN_PREVIEW
      ? ` (+${orphans.length - ORPHAN_PREVIEW} more)`
      : "";

  logger.log();
  logger.dim(
    `${orphans.length} key${orphans.length === 1 ? "" : "s"} in ${basename(dotenvPath)} aren't set on any container: ${preview}${more}.`,
  );
  logger.dim(
    "Pass --container <name> to choose which container they belong to.",
  );
}
