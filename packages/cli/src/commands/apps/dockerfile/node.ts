import {
  detectFrameworkFrom,
  detectPackageManagerFrom,
  type PackageManager,
} from "@bunny.net/framework-detector";
import {
  appName,
  type DetectedApp,
  dockerfile,
  type Project,
  readJson,
  versionFrom,
} from "./project.ts";

interface ServerFramework {
  label: string;
  /** Every dependency must be present (the framework plus its server adapter). */
  requires: string[];
  port: number;
  command: string[];
  /** Build output the server needs; the runtime stage copies only this. */
  output?: string;
}

// Ordered most-specific first. Meta-frameworks list their Node adapter
// too: without it the build is static or targets another platform.
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
    output: ".output",
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

// Libraries that mean the project runs its own HTTP server, even next to a
// frontend framework (an Express app with a Vite frontend, say).
const SERVER_LIBRARIES = [
  "express",
  "fastify",
  "koa",
  "hono",
  "elysia",
  "h3",
  "@hapi/hapi",
];

const LOCKFILES: Record<PackageManager, string[]> = {
  bun: ["bun.lock", "bun.lockb"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  npm: ["package-lock.json"],
};

// Config the install step reads, copied alongside the manifest.
const INSTALL_CONFIG_FILES = [".npmrc", ".yarnrc.yml", ".yarnrc"];

export const DEFAULT_NODE_VERSION = "24";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function nodeImage(project: Project, pkg: Record<string, unknown>): string {
  if (detectPackageManagerFrom(project.entries) === "bun") return "oven/bun:1";
  const engines = record(pkg.engines).node;
  const major = versionFrom(
    [
      project.read(".nvmrc"),
      project.read(".node-version"),
      typeof engines === "string" ? engines : null,
    ],
    /(?<!\d)(1[89]|[2-9]\d)(?!\d)/,
    DEFAULT_NODE_VERSION,
  );
  return `node:${major}-slim`;
}

function installCommand(project: Project, pm: PackageManager): string {
  const locked = LOCKFILES[pm].some((f) => project.entries.includes(f));
  const corepack = "corepack enable && ";
  switch (pm) {
    case "bun":
      return locked ? "bun install --frozen-lockfile" : "bun install";
    case "pnpm":
      return `${corepack}pnpm install${locked ? " --frozen-lockfile" : ""}`;
    case "yarn": {
      const flag = project.entries.includes(".yarnrc.yml")
        ? " --immutable"
        : " --frozen-lockfile";
      return `${corepack}yarn install${locked ? flag : ""}`;
    }
    case "npm":
      return locked ? "npm ci" : "npm install";
  }
}

/**
 * Lines for a build stage named `stage` that installs dependencies and runs
 * the `build` script. Shared with stacks that bundle frontend assets.
 */
export function nodeBuildStage(
  project: Project,
  pkg: Record<string, unknown>,
  stage: string,
): string[] {
  const pm = detectPackageManagerFrom(project.entries);
  const install = installCommand(project, pm);
  const lines = [`FROM ${nodeImage(project, pkg)} AS ${stage}`, "WORKDIR /app"];

  // Workspaces and patch directories are read during install, so they
  // need the whole tree; otherwise copy the manifest first to cache deps.
  const fullTree =
    Boolean(pkg.workspaces) ||
    ["pnpm-workspace.yaml", "patches", ".yarn"].some((f) =>
      project.entries.includes(f),
    );
  if (fullTree) {
    lines.push("COPY . .", `RUN ${install}`);
  } else {
    const manifest = [
      "package.json",
      ...[...LOCKFILES[pm], ...INSTALL_CONFIG_FILES].filter((f) =>
        project.entries.includes(f),
      ),
    ];
    lines.push(`COPY ${manifest.join(" ")} ./`, `RUN ${install}`, "COPY . .");
  }

  if (typeof record(pkg.scripts).build === "string") {
    const run = pm === "npm" || pm === "bun" ? pm : `corepack enable && ${pm}`;
    lines.push(`RUN ${run} run build`);
  }
  return lines;
}

/**
 * The bun image has no node binary: `node x` runs the file with bun, and
 * package binaries go through `bun run`, which shims `node` for their
 * `#!/usr/bin/env node` shebangs.
 */
function onBun(command: string[]): string[] {
  const [head, ...rest] = command;
  if (head === "node") return ["bun", ...rest];
  if (head?.startsWith("node_modules/.bin/")) {
    return ["bun", "run", head.slice("node_modules/.bin/".length), ...rest];
  }
  return command;
}

function nextStaticExport(project: Project): boolean {
  return ["next.config.js", "next.config.mjs", "next.config.ts"].some((f) =>
    /output:\s*["']export["']/.test(project.read(f) ?? ""),
  );
}

// Files a lone JS/TS server starts from, in order.
const SCRIPT_ENTRIES = [
  "server.ts",
  "index.ts",
  "main.ts",
  "server.js",
  "index.js",
  "main.js",
  "app.js",
];

/**
 * A lone script with no package.json runs on Bun, which runs TypeScript
 * as-is and installs the packages it imports when it starts.
 */
function detectScript(project: Project): DetectedApp | undefined {
  // Next to an index.html, the script is the page's browser code.
  if (project.entries.includes("index.html")) return undefined;
  const entry = SCRIPT_ENTRIES.find((e) => project.entries.includes(e));
  if (!entry) return undefined;
  return {
    label: "Bun",
    port: 3000,
    ignore: ["node_modules"],
    dockerfile: (port) =>
      dockerfile("Bun", [
        "FROM oven/bun:1",
        "WORKDIR /app",
        "COPY . .",
        `ENV NODE_ENV=production PORT=${port}`,
        `EXPOSE ${port}`,
        `CMD ["bun", "${entry}"]`,
      ]),
  };
}

export function detectNode(project: Project): DetectedApp | undefined {
  const pkg = readJson(project, "package.json");
  if (!pkg) return detectScript(project);

  const deps = new Set([
    ...Object.keys(record(pkg.dependencies)),
    ...Object.keys(record(pkg.devDependencies)),
  ]);
  const scripts = record(pkg.scripts);
  const bun = detectPackageManagerFrom(project.entries) === "bun";

  let server: Omit<ServerFramework, "requires"> | undefined =
    SERVER_FRAMEWORKS.find((f) => f.requires.every((dep) => deps.has(dep)));
  // A static export has no server to start; it's a Sites deploy.
  if (server?.label === "Next.js" && nextStaticExport(project)) {
    return undefined;
  }

  if (!server) {
    // A frontend framework without a server adapter builds static files,
    // and its `start` script is a dev server: that's a Sites deploy.
    const frontend = detectFrameworkFrom({
      entries: project.entries,
      packageJson: pkg,
    });
    if (
      frontend?.toolchain === "js" &&
      !SERVER_LIBRARIES.some((dep) => deps.has(dep))
    ) {
      return undefined;
    }

    const entry = [pkg.module, pkg.main].find((e) => typeof e === "string");
    const command =
      typeof scripts.start === "string"
        ? [bun ? "bun" : "npm", "run", "start"]
        : typeof entry === "string"
          ? ["node", entry]
          : undefined;
    if (!command) return undefined;
    server = { label: bun ? "Bun" : "Node.js", port: 3000, command };
  }

  const { label, output } = server;
  const command = bun ? onBun(server.command) : server.command;

  return {
    label,
    port: server.port,
    name: appName(pkg.name),
    ignore: [
      "node_modules",
      ".next",
      ".nuxt",
      ".output",
      ".svelte-kit",
      ".astro",
      "npm-debug.log*",
    ],
    dockerfile: (port) =>
      dockerfile(label, [
        ...nodeBuildStage(project, pkg, "build"),
        "",
        `FROM ${nodeImage(project, pkg)}`,
        "WORKDIR /app",
        // HOST and HOSTNAME bind every interface: frameworks default to
        // localhost, which is unreachable from outside the container.
        `ENV NODE_ENV=production PORT=${port} HOST=0.0.0.0 HOSTNAME=0.0.0.0`,
        output
          ? `COPY --from=build /app/${output} ./${output}`
          : "COPY --from=build /app ./",
        `EXPOSE ${port}`,
        `CMD ${JSON.stringify(command)}`,
      ]),
  };
}
