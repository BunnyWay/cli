import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectFrameworkFrom,
  detectPackageManagerFrom,
  type PackageManager,
} from "@bunny.net/framework-detector";

/**
 * Detect a Node or Bun server app from the project root and render a
 * Dockerfile for it, so `bunny apps deploy` works in a repo that has no
 * Dockerfile. The generated file is written to disk and owned by the user
 * from then on; the deploy builds it like any other Dockerfile.
 */

/** What detection reads from the project root. */
export interface AppSnapshot {
  /** Names of the files and directories at the project root. */
  entries: readonly string[];
  /** The parsed package.json, or null when there is none. */
  packageJson: Record<string, unknown> | null;
  /** Contents of `.nvmrc` or `.node-version`, when present. */
  nodeVersionFile?: string | null;
}

export interface AppPlan {
  /** Human-readable framework name, e.g. "Next.js". */
  label: string;
  packageManager: PackageManager;
  /** Base image runtime: `bun` uses oven/bun, everything else uses node. */
  runtime: "node" | "bun";
  /** Node major version for the node base image. */
  nodeVersion: number;
  /** Port the server listens on (set via `PORT` in the image). */
  port: number;
  /** Run the package.json `build` script during the image build. */
  build: boolean;
  /** Exec-form CMD. */
  command: string[];
  /** Paths copied into the runtime stage; omitted copies the whole app. */
  copy?: string[];
  /** Suggested app name from package.json. */
  appName?: string;
}

export const DEFAULT_NODE_VERSION = 24;

interface ServerFramework {
  label: string;
  /** Every dependency must be present (the framework plus its server adapter). */
  requires: string[];
  port: number;
  command: string[];
  copy?: string[];
}

// Ordered most-specific first. Meta-frameworks that only produce a server
// with a Node adapter list the adapter too; without it the build is static
// or targets another platform and isn't something we can run.
const SERVER_FRAMEWORKS: ServerFramework[] = [
  {
    label: "Next.js",
    requires: ["next"],
    port: 3000,
    command: ["node_modules/.bin/next", "start"],
  },
  {
    label: "Nuxt",
    requires: ["nuxt"],
    port: 3000,
    command: ["node", ".output/server/index.mjs"],
    copy: [".output"],
  },
  {
    label: "SvelteKit",
    requires: ["@sveltejs/kit", "@sveltejs/adapter-node"],
    port: 3000,
    command: ["node", "build/index.js"],
  },
  {
    label: "Astro",
    requires: ["astro", "@astrojs/node"],
    port: 4321,
    command: ["node", "dist/server/entry.mjs"],
  },
  {
    label: "React Router",
    requires: ["@react-router/serve"],
    port: 3000,
    command: ["node_modules/.bin/react-router-serve", "build/server/index.js"],
  },
  {
    label: "Remix",
    requires: ["@remix-run/serve"],
    port: 3000,
    command: ["node_modules/.bin/remix-serve", "build/index.js"],
  },
  {
    label: "NestJS",
    requires: ["@nestjs/core"],
    port: 3000,
    command: ["node", "dist/main.js"],
  },
];

// Libraries that mean the project runs its own HTTP server.
const SERVER_LIBRARIES = [
  "express",
  "fastify",
  "koa",
  "hono",
  "elysia",
  "h3",
  "@hapi/hapi",
];

function dependencies(pkg: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (deps && typeof deps === "object") {
      for (const name of Object.keys(deps)) names.add(name);
    }
  }
  return names;
}

function scripts(pkg: Record<string, unknown>): Record<string, string> {
  const value = pkg.scripts;
  return value && typeof value === "object"
    ? (value as Record<string, string>)
    : {};
}

/** First plausible Node major in `.nvmrc`, `.node-version` or `engines.node`. */
export function nodeMajorFrom(
  nodeVersionFile: string | null | undefined,
  engines: unknown,
): number {
  const candidates = [
    nodeVersionFile,
    engines && typeof engines === "object"
      ? (engines as Record<string, unknown>).node
      : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const major = Number(candidate.match(/\d+/)?.[0]);
    if (major >= 18 && major < 100) return major;
  }
  return DEFAULT_NODE_VERSION;
}

/**
 * Work out how to containerise a Node/Bun project, or undefined when it
 * isn't one we can run: no package.json, or no framework, `start` script
 * or entry point to start a server from.
 */
export function detectAppFrom(snapshot: AppSnapshot): AppPlan | undefined {
  const pkg = snapshot.packageJson;
  if (!pkg) return undefined;

  const deps = dependencies(pkg);
  const pkgScripts = scripts(pkg);
  const packageManager = detectPackageManagerFrom(snapshot.entries);
  const runtime = packageManager === "bun" ? "bun" : "node";
  const base = {
    packageManager,
    runtime,
    nodeVersion: nodeMajorFrom(snapshot.nodeVersionFile, pkg.engines),
    build: typeof pkgScripts.build === "string",
    appName: appNameFrom(pkg.name),
  } as const;

  const framework = SERVER_FRAMEWORKS.find((f) =>
    f.requires.every((dep) => deps.has(dep)),
  );
  if (framework) {
    return {
      ...base,
      label: framework.label,
      port: framework.port,
      command: runtime === "bun" ? onBun(framework.command) : framework.command,
      copy: framework.copy,
    };
  }

  // A frontend framework without a server adapter builds static files, and
  // its `start` script is a dev server: that's a Sites deploy, not an app.
  // Unless a server library is also present (an Express app with a Vite
  // frontend, say), the server is what we run.
  const frontend = detectFrameworkFrom(snapshot);
  if (
    frontend?.toolchain === "js" &&
    !SERVER_LIBRARIES.some((dep) => deps.has(dep))
  ) {
    return undefined;
  }

  const label = runtime === "bun" ? "Bun" : "Node.js";
  if (typeof pkgScripts.start === "string") {
    return {
      ...base,
      label,
      port: 3000,
      command: [runtime === "bun" ? "bun" : "npm", "run", "start"],
    };
  }

  const entry =
    typeof pkg.module === "string"
      ? pkg.module
      : typeof pkg.main === "string"
        ? pkg.main
        : undefined;
  if (entry) {
    return {
      ...base,
      label,
      port: 3000,
      command: [runtime === "bun" ? "bun" : "node", entry],
    };
  }

  return undefined;
}

/**
 * Adapt a node command to the bun image, which has no node binary:
 * `node x` runs the file with bun, and package binaries go through
 * `bun run`, which shims `node` for their `#!/usr/bin/env node` shebangs.
 */
function onBun(command: string[]): string[] {
  const [head, ...rest] = command;
  if (head === "node") return ["bun", ...rest];
  if (head?.startsWith("node_modules/.bin/")) {
    return ["bun", "run", head.slice("node_modules/.bin/".length), ...rest];
  }
  return command;
}

/** `@scope/my-app` → `my-app`; undefined for missing or unusable names. */
function appNameFrom(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const bare = name.split("/").pop()?.trim();
  return bare || undefined;
}

function readOptional(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Read what detection needs from the project root, or undefined when it can't be read. */
export function readAppSnapshot(root: string): AppSnapshot | undefined {
  try {
    return {
      entries: readdirSync(root),
      packageJson: JSON.parse(
        readOptional(join(root, "package.json")) ?? "null",
      ),
      nodeVersionFile:
        readOptional(join(root, ".nvmrc")) ??
        readOptional(join(root, ".node-version")),
    };
  } catch {
    return undefined;
  }
}

const LOCKFILES: Record<PackageManager, string[]> = {
  bun: ["bun.lock", "bun.lockb"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  npm: ["package-lock.json"],
};

// Config the install step reads, copied alongside the manifest when present.
const INSTALL_CONFIG_FILES = [".npmrc", ".yarnrc.yml", ".yarnrc"];

function installCommand(
  packageManager: PackageManager,
  entries: readonly string[],
): string {
  const hasLockfile = LOCKFILES[packageManager].some((f) =>
    entries.includes(f),
  );
  switch (packageManager) {
    case "bun":
      return hasLockfile ? "bun install --frozen-lockfile" : "bun install";
    case "pnpm":
      return hasLockfile
        ? "corepack enable && pnpm install --frozen-lockfile"
        : "corepack enable && pnpm install";
    case "yarn":
      if (!hasLockfile) return "corepack enable && yarn install";
      return entries.includes(".yarnrc.yml")
        ? "corepack enable && yarn install --immutable"
        : "corepack enable && yarn install --frozen-lockfile";
    case "npm":
      return hasLockfile ? "npm ci" : "npm install";
  }
}

function buildCommand(packageManager: PackageManager): string {
  return packageManager === "npm"
    ? "npm run build"
    : `${packageManager === "bun" ? "bun" : `corepack enable && ${packageManager}`} run build`;
}

/**
 * Whether the install step needs the whole source tree: workspaces pull
 * in nested package.json files, and patch/plugin directories are read
 * during install.
 */
function needsFullSourceForInstall(
  entries: readonly string[],
  packageJson: Record<string, unknown> | null,
): boolean {
  return (
    Boolean(packageJson?.workspaces) ||
    entries.includes("pnpm-workspace.yaml") ||
    entries.includes("patches") ||
    entries.includes(".yarn")
  );
}

/**
 * Render a two-stage Dockerfile for `plan`: install and build in the first
 * stage, then copy the app (or just its build output) into the runtime
 * stage. `entries` and `packageJson` decide which files the install step
 * needs, so dependency layers cache across source changes.
 */
export function renderDockerfile(
  plan: AppPlan,
  snapshot: Pick<AppSnapshot, "entries" | "packageJson">,
): string {
  const image =
    plan.runtime === "bun" ? "oven/bun:1" : `node:${plan.nodeVersion}-slim`;
  const { entries } = snapshot;

  const lines = [
    `# Generated by \`bunny apps deploy\` for ${plan.label}. Edit freely: deploys build this file as-is.`,
    `FROM ${image} AS build`,
    "WORKDIR /app",
  ];

  if (needsFullSourceForInstall(entries, snapshot.packageJson)) {
    lines.push(
      "COPY . .",
      `RUN ${installCommand(plan.packageManager, entries)}`,
    );
  } else {
    const manifest = [
      "package.json",
      ...LOCKFILES[plan.packageManager],
      ...INSTALL_CONFIG_FILES,
    ].filter((f) => f === "package.json" || entries.includes(f));
    lines.push(
      `COPY ${manifest.join(" ")} ./`,
      `RUN ${installCommand(plan.packageManager, entries)}`,
      "COPY . .",
    );
  }

  if (plan.build) lines.push(`RUN ${buildCommand(plan.packageManager)}`);

  lines.push(
    "",
    `FROM ${image}`,
    "WORKDIR /app",
    // HOST and HOSTNAME bind the server to every interface: frameworks
    // default to localhost, which is unreachable from outside the container.
    `ENV NODE_ENV=production PORT=${plan.port} HOST=0.0.0.0 HOSTNAME=0.0.0.0`,
  );
  if (plan.copy) {
    for (const path of plan.copy) {
      lines.push(`COPY --from=build /app/${path} ./${path}`);
    }
  } else {
    lines.push("COPY --from=build /app ./");
  }
  lines.push(`EXPOSE ${plan.port}`, `CMD ${JSON.stringify(plan.command)}`, "");

  return lines.join("\n");
}

/**
 * Keeps local installs, build output and secrets out of the build context.
 * `.env` files must never be baked into an image; `bunny apps env` sets
 * them at runtime instead.
 */
export const DOCKERIGNORE = `${[
  "# Generated by `bunny apps deploy`.",
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".astro",
  ".env",
  ".env.*",
  "!.env.example",
  "npm-debug.log*",
  "Dockerfile",
  ".dockerignore",
].join("\n")}\n`;
