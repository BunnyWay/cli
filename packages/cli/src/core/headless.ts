import { existsSync } from "node:fs";

/** Why the current shell probably cannot show the user a browser window. */
export interface HeadlessReason {
  kind: "ssh" | "ci" | "container" | "no-display" | "unsupported-platform";
  /** One-line explanation shown before offering the API key fallback. */
  message: string;
}

const CI_VARS = [
  "CI",
  "BUILDKITE",
  "CIRCLECI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
  "TF_BUILD",
];

const SSH_VARS = ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"];

/** CI markers are often exported as `CI=false` to opt out; treat false-like values as unset. */
function isAffirmative(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "false" && normalized !== "0";
}

/** Platforms with a browser opener in `openBrowser`. */
const BROWSER_PLATFORMS = new Set(["darwin", "linux", "win32"]);

/** Container runtimes drop these markers in the root filesystem. */
const CONTAINER_MARKERS = ["/.dockerenv", "/run/.containerenv"];

/** Detect a shell where a browser either won't launch or won't be visible to the user; `null` means the browser flow is plausible. `fileExists` is injectable so tests control the container probe instead of reading the runner's own filesystem. */
export function detectHeadless(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): HeadlessReason | null {
  if (SSH_VARS.some((v) => env[v])) {
    return {
      kind: "ssh",
      message:
        "You appear to be connected over SSH, so a browser opened here won't reach you.",
    };
  }

  const ci = CI_VARS.find((v) => isAffirmative(env[v]));
  if (ci) {
    return {
      kind: "ci",
      message: `This looks like a CI environment (${ci} is set).`,
    };
  }

  if (!BROWSER_PLATFORMS.has(platform)) {
    return {
      kind: "unsupported-platform",
      message: `No known way to open a browser on ${platform}.`,
    };
  }

  // DISPLAY/WAYLAND_DISPLAY are the only signal that a Unix box has a desktop; macOS and Windows always do.
  if (platform !== "darwin" && platform !== "win32") {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
      return {
        kind: "no-display",
        message:
          "No display server detected (DISPLAY and WAYLAND_DISPLAY are unset).",
      };
    }
  }

  if (CONTAINER_MARKERS.some((path) => fileExists(path))) {
    return {
      kind: "container",
      message: "This looks like a container, which usually has no browser.",
    };
  }

  return null;
}
