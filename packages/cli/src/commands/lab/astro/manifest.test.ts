import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../../test-utils/temp-dir.ts";
import {
  loadBuildManifest,
  minimumCliVersion,
  resolveAssetsDir,
  resolveScriptEntry,
} from "./manifest.ts";

const tempDir = useTempDir("bunny-manifest-");

function validManifest(overrides?: Record<string, unknown>) {
  return {
    manifestVersion: 1,
    adapter: { package: "@bunny.net/astro-adapter", version: "0.2.0" },
    framework: { name: "astro", version: "7.2.3" },
    kind: "ssr",
    script: { entry: "dist/index.js", type: "standalone", bytes: 1234 },
    assets: { dir: "dist/client" },
    ...overrides,
  };
}

/** Write a manifest, and optionally the build it describes. */
function project(
  root: string,
  manifest: unknown,
  opts?: { build?: boolean },
): void {
  mkdirSync(join(root, ".bunny"), { recursive: true });
  writeFileSync(
    join(root, ".bunny/build.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
  );
  if (opts?.build) {
    mkdirSync(join(root, "dist/client/_astro"), { recursive: true });
    writeFileSync(join(root, "dist/index.js"), "export default 1;");
    writeFileSync(join(root, "dist/client/_astro/app.css"), "body{}");
  }
}

test("minimumCliVersion reads a >= floor and ignores anything else", () => {
  expect(minimumCliVersion(">=2.6.0")).toBe("2.6.0");
  expect(minimumCliVersion("  >= 2.6.0 ")).toBe("2.6.0");
  // An unparseable range must not stop a deploy: an adapter's guess about a
  // future CLI is not worth failing over.
  expect(minimumCliVersion("^2.6.0")).toBeNull();
  expect(minimumCliVersion(undefined)).toBeNull();
});

test("no manifest is not an error; it means the project builds no server", async () => {
  expect(await loadBuildManifest(tempDir())).toBeNull();
});

test("a manifest is read, and its root is the directory holding .bunny", async () => {
  const root = tempDir();
  project(root, validManifest());
  const loaded = await loadBuildManifest(root);
  expect(loaded?.root).toBe(root);
  expect(loaded?.manifest.kind).toBe("ssr");
  expect(loaded?.manifest.script?.entry).toBe("dist/index.js");
});

test("the manifest is found from a subdirectory of the project", async () => {
  const root = tempDir();
  project(root, validManifest());
  mkdirSync(join(root, "src/pages"), { recursive: true });
  const loaded = await loadBuildManifest(join(root, "src/pages"));
  expect(loaded?.root).toBe(root);
});

test("a manifest that is not JSON stops the deploy", async () => {
  const root = tempDir();
  project(root, "{ not json");
  await expect(loadBuildManifest(root)).rejects.toThrow(/not valid JSON/);
});

test("a manifest missing a required field stops the deploy", async () => {
  const root = tempDir();
  project(root, { manifestVersion: 1, kind: "ssr" });
  await expect(loadBuildManifest(root)).rejects.toThrow(
    /not a build manifest this CLI understands/,
  );
});

// Half a deployed site is worse than none, so an unknown shape is refused.
test("a newer manifest version asks for a newer CLI", async () => {
  const root = tempDir();
  project(root, validManifest({ manifestVersion: 99 }));
  await expect(loadBuildManifest(root)).rejects.toThrow(
    /version 99, and this CLI reads 1/,
  );
});

test("an adapter that needs a newer CLI says so, naming the version", async () => {
  const root = tempDir();
  project(root, validManifest({ requires: { cliVersion: ">=999.0.0" } }));
  await expect(loadBuildManifest(root)).rejects.toThrow(
    /needs bunny CLI 999\.0\.0 or newer/,
  );
});

test("the CLI's own version satisfies a floor it is above", async () => {
  const root = tempDir();
  project(root, validManifest({ requires: { cliVersion: ">=0.0.1" } }));
  expect((await loadBuildManifest(root))?.manifest.kind).toBe("ssr");
});

test("a server build with no script named is refused", async () => {
  const root = tempDir();
  project(root, validManifest({ script: undefined }));
  await expect(loadBuildManifest(root)).rejects.toThrow(
    /server build with no script/,
  );
});

test("a static manifest needs no script", async () => {
  const root = tempDir();
  project(root, validManifest({ kind: "static", script: undefined }));
  expect((await loadBuildManifest(root))?.manifest.kind).toBe("static");
});

test("the script entry and the assets directory resolve against the root", async () => {
  const root = tempDir();
  project(root, validManifest(), { build: true });
  const loaded = await loadBuildManifest(root);
  if (!loaded) throw new Error("expected a manifest");
  expect(resolveScriptEntry(loaded)).toBe(join(root, "dist/index.js"));
  expect(resolveAssetsDir(loaded)).toBe(join(root, "dist/client"));
});

test("a manifest that points at a missing build says to build again", async () => {
  const root = tempDir();
  project(root, validManifest());
  const loaded = await loadBuildManifest(root);
  if (!loaded) throw new Error("expected a manifest");
  expect(() => resolveScriptEntry(loaded)).toThrow(/which is not there/);
  expect(() => resolveAssetsDir(loaded)).toThrow(/not a directory/);
});
