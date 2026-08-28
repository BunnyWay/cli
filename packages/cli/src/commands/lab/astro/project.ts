/**
 * Which directory the deploy is about, and whether Astro there can be deployed.
 *
 * A monorepo root is not a project. `withastro/starlight` keeps `astro` in the
 * root `package.json` for `astro check`, and its site is `docs/`. Reading only
 * the root, the CLI detected Astro, offered to add an adapter to a package that
 * builds nothing, and `pnpm add` refused to touch a workspace root at all.
 *
 * So a project has to look like one: it needs a config file, or pages. When this
 * directory has neither, the workspace usually holds one that does.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { readPackageJson } from "../../../core/package-manager.ts";
import { isInteractive, prompts } from "../../../core/ui.ts";
import { findAstroConfig } from "./adapter.ts";

/** Directories that hold no deployable site, however deep the search goes. */
const SKIP = new Set([
  "node_modules",
  ".git",
  ".astro",
  ".bunny",
  ".cache",
  ".github",
  ".vscode",
  "dist",
  "build",
  "out",
  "public",
  "src",
  "test",
  "tests",
  "__tests__",
  "e2e",
  "fixtures",
  "coverage",
]);

/** How far down to look. Deeper than this is a fixture, not the site. */
const MAX_DEPTH = 3;

/** Names that usually hold the site a repository is about. */
const LIKELY = [
  "docs",
  "site",
  "sites",
  "www",
  "web",
  "app",
  "apps",
  "frontend",
  "website",
];

/** Names that usually hold something else that happens to be a site. */
const UNLIKELY = [
  "example",
  "examples",
  "demo",
  "demos",
  "playground",
  "template",
  "templates",
];

export interface Candidate {
  dir: string;
  /** The path to show, relative to where the search started. */
  label: string;
}

/** True when this directory is itself an Astro project. */
export function isAstroProject(dir: string): boolean {
  return Boolean(findAstroConfig(dir)) || existsSync(join(dir, "src/pages"));
}

/** Rank: a likely name first, an example last, and a shallower path before a deeper one. */
function score(label: string): number {
  const parts = label.split("/");
  const first = parts[0] ?? "";
  let value = parts.length * 10;
  if (LIKELY.includes(first)) value -= 100;
  if (parts.some((part) => UNLIKELY.includes(part))) value += 100;
  return value;
}

/**
 * Every Astro project under `root`, nearest first.
 *
 * `root` itself is not a candidate: this is only called when it is not one.
 */
export function findAstroProjects(root: string): Candidate[] {
  const found: Candidate[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !SKIP.has(entry.name) &&
            entry.name[0] !== ".",
        )
        .map((entry) => entry.name);
    } catch {
      return;
    }
    for (const name of entries) {
      const child = join(dir, name);
      if (isAstroProject(child)) {
        found.push({
          dir: child,
          label: relative(root, child).split("\\").join("/"),
        });
        // A project inside a project is that project's own fixture.
        continue;
      }
      walk(child, depth + 1);
    }
  };

  walk(root, 1);
  return found.sort(
    (a, b) => score(a.label) - score(b.label) || a.label.localeCompare(b.label),
  );
}

/**
 * The directory this deploy is about.
 *
 * Everything after this reads it: the config, the build, and the state file that
 * links the directory to what it deploys to.
 */
export async function resolveProject(
  dir: string | undefined,
  output: string | undefined,
): Promise<string> {
  const root = resolve(dir ?? process.cwd());
  if (!existsSync(root)) {
    throw new UserError(`${root} is not there.`);
  }
  if (isAstroProject(root)) return root;

  const candidates = findAstroProjects(root);
  if (candidates.length === 0) {
    throw new UserError(
      `There is no Astro project in ${dir ?? "this directory"}.`,
      "An Astro project has an astro.config file, or a src/pages directory.",
    );
  }

  const list = candidates.map((candidate) => `  ${candidate.label}`).join("\n");
  if (!isInteractive(output)) {
    throw new UserError(
      `There is no Astro project in this directory, and ${candidates.length} below it.`,
      `Name the one to deploy:\n${list}\n\n  bunny lab deploy astro <dir>`,
    );
  }

  logger.info(
    candidates.length === 1
      ? "This directory holds no Astro project, and one below it does."
      : `This directory holds no Astro project, and ${candidates.length} below it do.`,
  );

  const { value } = await prompts({
    type: "select",
    name: "value",
    message: "Which one should be deployed?",
    choices: [
      ...candidates.map((candidate) => ({
        title: candidate.label,
        value: candidate.dir,
      })),
      { title: "None of these", value: "" },
    ],
    initial: 0,
  });

  const chosen = value as string | undefined;
  if (!chosen) {
    throw new UserError(
      "Nothing to deploy here.",
      "Run the command in the project's own directory.",
    );
  }
  logger.info(`Deploying ${relative(root, chosen) || "."}.`);
  return chosen;
}

/** The lowest Astro this adapter runs on. Its peer range is `^7.0.0`. */
export const MINIMUM_ASTRO_MAJOR = 7;

/** The declared Astro range, from the project's `package.json`. */
export async function astroRange(root: string): Promise<string | null> {
  const pkg = await readPackageJson(root);
  const deps = {
    ...(pkg?.dependencies as Record<string, string> | undefined),
    ...(pkg?.devDependencies as Record<string, string> | undefined),
  };
  return deps.astro ?? null;
}

/**
 * The first major a range allows, or null when this cannot tell.
 *
 * Only the forms a `package.json` actually holds are read: `^7.2.6`, `~7.2`,
 * `>=7`, `7.2.6`, and a bare `7`. A range this cannot parse must not stop a
 * deploy, because the build is the real test.
 */
export function majorFrom(range: string): number | null {
  const match = /(\d+)/.exec(range.replace(/^[\^~><= v]+/, ""));
  const major = match ? Number.parseInt(match[1] as string, 10) : Number.NaN;
  return Number.isNaN(major) ? null : major;
}

/**
 * Stop a project whose Astro is too old for the adapter.
 *
 * This is the one change no deploy command can make for somebody. A framework
 * major moves APIs, and upgrading one is the developer's decision, taken with
 * their own tests in front of them. `render-examples/astro-ssr` ships Astro 5,
 * and `npm install` refuses the adapter outright, so the message has to arrive
 * before the install rather than out of npm's own error.
 */
export async function requireSupportedAstro(root: string): Promise<void> {
  const range = await astroRange(root);
  if (range === null) {
    throw new UserError(
      "This project does not depend on Astro.",
      "Run the command in an Astro project, or add Astro to this one.",
    );
  }
  const major = majorFrom(range);
  if (major === null || major >= MINIMUM_ASTRO_MAJOR) return;

  throw new UserError(
    `This project uses Astro ${major}, and @bunny.net/astro-adapter needs Astro ${MINIMUM_ASTRO_MAJOR}.`,
    [
      "Upgrade Astro first, and run its own migration:",
      "",
      "  npx @astrojs/upgrade",
      "",
      "A framework major changes APIs, so this command will not do it for you.",
    ].join("\n"),
  );
}
