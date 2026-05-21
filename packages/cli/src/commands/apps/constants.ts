import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";

type ApplicationStatus = components["schemas"]["ApplicationStatus"];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  unknown: "Unknown",
  active: "Active",
  progressing: "Deploying",
  inactive: "Inactive",
  failing: "Failing",
  suspended: "Suspended",
};

/** Filename for the linked-app manifest stored under `.bunny/`. */
export const APP_MANIFEST = "app.json";

/**
 * Shape of `.bunny/app.json`.
 *
 * Per-user, per-clone state that pairs a working directory with a
 * specific MC app on someone's account. `bunny.jsonc` is *intent*; this
 * manifest is *identity* - which app ID this directory points at, which
 * MC container template IDs map to which user-facing names, and which
 * account-scoped registry record each container pushes/pulls through.
 */
export interface AppManifest {
  /** MC application ID this directory is linked to. */
  id: string;
  /**
   * CLI profile used when this link was created. Advisory - surfaced as
   * a warning when commands run under a different profile, to catch
   * "wrong account, wrong day" mistakes.
   */
  profile?: string;
  /**
   * User-facing container name (matches the key in
   * `bunny.jsonc.app.containers`) → resolved API identity:
   * - `id`: MC container template ID (lets us PATCH the right container
   *   without a full re-fetch every deploy).
   * - `registry`: the user's MC registry record this container pushes
   *   to / pulls from. Registries are account-scoped so this can't live
   *   in shared config.
   */
  containers: Record<string, { id?: string; registry?: string }>;
}
