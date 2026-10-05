import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  detectFrameworkFrom,
  detectPackageManagerFrom,
  type FrameworkPreset,
  type PackageManager,
} from "@bunny.net/framework-detector";

export {
  FRAMEWORK_PRESETS,
  type FrameworkPreset,
  findPreset,
  type PackageManager,
  presetBuildCommand,
} from "@bunny.net/framework-detector";

export async function readPackageJson(
  root: string,
): Promise<Record<string, unknown> | null> {
  try {
    return (await Bun.file(join(root, "package.json")).json()) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

async function rootEntries(root: string): Promise<string[]> {
  try {
    return await readdir(root);
  } catch {
    return [];
  }
}

export async function detectFramework(
  root: string,
): Promise<FrameworkPreset | undefined> {
  const entries = await rootEntries(root);
  const csprojs = await Promise.all(
    entries
      .filter((name) => name.endsWith(".csproj"))
      .map(async (name) => ({
        name,
        text: (await readText(join(root, name))) ?? "",
      })),
  );
  return detectFrameworkFrom({
    entries,
    packageJson: await readPackageJson(root),
    gemfile: await readText(join(root, "Gemfile")),
    csprojs,
  });
}

export async function detectPackageManager(
  root: string,
): Promise<PackageManager> {
  return detectPackageManagerFrom(await rootEntries(root));
}
