import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  BUILD_MANIFEST_PATH,
  BUILD_MANIFEST_VERSION,
  type BuildManifest,
  BuildManifestSchema,
} from "@bunny.net/config";
import { UserError } from "../../../core/errors.ts";
import { VERSION } from "../../../core/version.ts";

export interface LoadedBuildManifest {
  manifest: BuildManifest;
  /** The directory holding `.bunny/build.json`; every path in the manifest resolves against it. */
  root: string;
}

/** Walk up from `from` looking for `.bunny/build.json`. */
function findManifest(from: string): string | null {
  let dir = resolve(from);
  while (true) {
    const candidate = join(dir, BUILD_MANIFEST_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Compare dotted numbers; a suffix like `-beta.1` is ignored, which is the right call for a floor check.
function isAtLeast(version: string, minimum: string): boolean {
  const parts = (v: string) =>
    (v.split("-")[0] ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(version), parts(minimum)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/**
 * The `>=x.y.z` floor from a `requires.cliVersion` range, or null.
 *
 * Only that one form is honoured. A range this CLI cannot parse must not stop a
 * deploy: an adapter's opinion about a future CLI is not worth a hard failure.
 */
export function minimumCliVersion(range: string | undefined): string | null {
  const match = /^\s*>=\s*(\d+\.\d+\.\d+[\w.-]*)\s*$/.exec(range ?? "");
  return match?.[1] ?? null;
}

/**
 * Read the build manifest, or null when the project has none.
 *
 * A manifest that exists but does not parse is an error: it means an adapter
 * wrote something this CLI cannot act on, and deploying half a site is worse
 * than stopping.
 */
export async function loadBuildManifest(
  from: string = process.cwd(),
): Promise<LoadedBuildManifest | null> {
  const path = findManifest(from);
  if (!path) return null;

  let data: unknown;
  try {
    data = await Bun.file(path).json();
  } catch {
    throw new UserError(
      `${path} is not valid JSON.`,
      "Run the project's build again to rewrite it.",
    );
  }

  const parsed = BuildManifestSchema.safeParse(data);
  if (!parsed.success) {
    throw new UserError(
      `${path} is not a build manifest this CLI understands.`,
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "manifest"}: ${i.message}`)
        .join("; "),
    );
  }
  const manifest = parsed.data;

  if (manifest.manifestVersion > BUILD_MANIFEST_VERSION) {
    throw new UserError(
      `${manifest.adapter.package} wrote a build manifest of version ${manifest.manifestVersion}, and this CLI reads ${BUILD_MANIFEST_VERSION}.`,
      "Update the CLI: npm install -g @bunny.net/cli",
    );
  }

  const floor = minimumCliVersion(manifest.requires?.cliVersion);
  if (floor && !isAtLeast(VERSION, floor)) {
    throw new UserError(
      `${manifest.adapter.package} needs bunny CLI ${floor} or newer, and this is ${VERSION}.`,
      "Update the CLI: npm install -g @bunny.net/cli",
    );
  }

  if (manifest.kind === "ssr" && !manifest.script) {
    throw new UserError(
      `${manifest.adapter.package} reports a server build with no script to deploy.`,
      "Run the project's build again. Report it to the adapter if it persists.",
    );
  }

  return { manifest, root: dirname(dirname(path)) };
}

/** The built file to deploy, checked for existence. */
export function resolveScriptEntry(loaded: LoadedBuildManifest): string {
  const entry = loaded.manifest.script?.entry;
  if (!entry) throw new UserError("The build manifest names no script entry.");
  const path = resolve(loaded.root, entry);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new UserError(
      `The build manifest points at ${entry}, which is not there.`,
      "Run the build again.",
    );
  }
  return path;
}

/** The folder of client files to upload, checked for existence. */
export function resolveAssetsDir(loaded: LoadedBuildManifest): string {
  const path = resolve(loaded.root, loaded.manifest.assets.dir);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new UserError(
      `The build manifest points at ${loaded.manifest.assets.dir}, which is not a directory.`,
      "Run the build again.",
    );
  }
  return path;
}

/**
 * Refuse anything but a build that renders per request.
 *
 * A static Astro build is a directory of files, and it has a home already. This
 * command deploys one Edge Script, so a build with no script in it is not
 * something it can carry halfway.
 */
export function requireSsrBuild(loaded: LoadedBuildManifest): void {
  if (loaded.manifest.kind === "ssr") return;
  throw new UserError(
    "This Astro build prerenders every page, so it needs no server.",
    [
      `Deploy the ${loaded.manifest.assets.dir} directory as files:`,
      "",
      `  bunny sites deploy ${loaded.manifest.assets.dir}`,
      "",
      "A page renders per request when it exports `prerender = false`.",
    ].join("\n"),
  );
}

/** Refuse a manifest another framework's adapter wrote. */
export function requireAstroBuild(loaded: LoadedBuildManifest): void {
  const name = loaded.manifest.framework.name.toLowerCase();
  if (name === "astro") return;
  throw new UserError(
    `.bunny/build.json says this build is ${loaded.manifest.framework.name}, not Astro.`,
    "This command deploys Astro. Delete .bunny/build.json and build again if that is wrong.",
  );
}
