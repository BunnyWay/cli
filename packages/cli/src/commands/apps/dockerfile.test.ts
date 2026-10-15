import { describe, expect, test } from "bun:test";
import {
  type AppSnapshot,
  DEFAULT_NODE_VERSION,
  DOCKERIGNORE,
  detectAppFrom,
  renderDockerfile,
} from "./dockerfile.ts";

function snapshot(
  packageJson: Record<string, unknown> | null,
  entries: string[] = ["package.json"],
  nodeVersionFile?: string,
): AppSnapshot {
  return { entries, packageJson, nodeVersionFile };
}

describe("detectAppFrom", () => {
  test("no package.json is not an app", () => {
    expect(detectAppFrom(snapshot(null, []))).toBeUndefined();
  });

  test("Next.js runs next start on 3000", () => {
    const plan = detectAppFrom(
      snapshot({
        name: "@acme/web",
        scripts: { build: "next build", start: "next start" },
        dependencies: { next: "15.0.0" },
      }),
    );
    expect(plan).toMatchObject({
      label: "Next.js",
      port: 3000,
      build: true,
      runtime: "node",
      appName: "web",
      command: ["node_modules/.bin/next", "start"],
    });
  });

  test("Astro needs the node adapter to be a server", () => {
    const deps = { astro: "5.0.0" };
    expect(detectAppFrom(snapshot({ dependencies: deps }))).toBeUndefined();
    expect(
      detectAppFrom(
        snapshot({ dependencies: { ...deps, "@astrojs/node": "9.0.0" } }),
      ),
    ).toMatchObject({ label: "Astro", port: 4321 });
  });

  test("a frontend's dev-server start script is not an app", () => {
    const plan = detectAppFrom(
      snapshot({
        scripts: { start: "react-scripts start", build: "react-scripts build" },
        dependencies: { "react-scripts": "5.0.0" },
      }),
    );
    expect(plan).toBeUndefined();
  });

  test("a frontend with its own server runs the server", () => {
    const plan = detectAppFrom(
      snapshot({
        scripts: { start: "node server.js" },
        dependencies: { express: "5.0.0", vite: "6.0.0" },
      }),
    );
    expect(plan).toMatchObject({
      label: "Node.js",
      command: ["npm", "run", "start"],
    });
  });

  test("Bun lockfile runs on the bun image and swaps node for bun", () => {
    const plan = detectAppFrom(
      snapshot(
        { dependencies: { nuxt: "3.0.0" }, scripts: { build: "nuxt build" } },
        ["package.json", "bun.lock"],
      ),
    );
    expect(plan).toMatchObject({
      runtime: "bun",
      command: ["bun", ".output/server/index.mjs"],
    });
  });

  test("an entry point without a start script runs the entry", () => {
    expect(
      detectAppFrom(
        snapshot({ module: "src/index.ts" }, ["package.json", "bun.lockb"]),
      )?.command,
    ).toEqual(["bun", "src/index.ts"]);
  });

  test("nothing to start is not an app", () => {
    expect(
      detectAppFrom(snapshot({ scripts: { test: "bun test" } })),
    ).toBeUndefined();
  });

  test.each([
    ["20.11.0\n", undefined, 20],
    [undefined, ">=22", 22],
    ["lts/*", undefined, DEFAULT_NODE_VERSION],
    [undefined, undefined, DEFAULT_NODE_VERSION],
  ])("node version from %j / engines %j → %d", (file, engines, expected) => {
    const plan = detectAppFrom(
      snapshot(
        { scripts: { start: "node ." }, engines: { node: engines } },
        ["package.json"],
        file,
      ),
    );
    expect(plan?.nodeVersion).toBe(expected);
  });
});

describe("renderDockerfile", () => {
  test("installs from the lockfile before copying source so deps cache", () => {
    const snap = snapshot(
      {
        scripts: { build: "next build" },
        dependencies: { next: "15.0.0" },
      },
      ["package.json", "package-lock.json", ".npmrc", "src"],
    );
    const plan = detectAppFrom(snap);
    if (!plan) throw new Error("expected a plan");
    const lines = renderDockerfile(plan, snap).split("\n");

    const copyManifest = lines.indexOf(
      "COPY package.json package-lock.json .npmrc ./",
    );
    const install = lines.indexOf("RUN npm ci");
    const copySource = lines.indexOf("COPY . .");
    expect(copyManifest).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(copyManifest);
    expect(copySource).toBeGreaterThan(install);
    expect(lines).toContain("RUN npm run build");
    expect(lines).toContain("EXPOSE 3000");
    expect(lines).toContain('CMD ["node_modules/.bin/next","start"]');
  });

  test("workspaces install from the full source tree", () => {
    const snap = snapshot(
      { workspaces: ["apps/*"], scripts: { start: "node ." } },
      ["package.json", "pnpm-lock.yaml"],
    );
    const plan = detectAppFrom(snap);
    if (!plan) throw new Error("expected a plan");
    const text = renderDockerfile(plan, snap);
    expect(text).toContain(
      "COPY . .\nRUN corepack enable && pnpm install --frozen-lockfile",
    );
  });

  test("Nuxt ships only its build output", () => {
    const snap = snapshot(
      { dependencies: { nuxt: "3.0.0" }, scripts: { build: "nuxt build" } },
      ["package.json", "yarn.lock", ".yarnrc.yml"],
    );
    const plan = detectAppFrom(snap);
    if (!plan) throw new Error("expected a plan");
    const text = renderDockerfile(plan, snap);
    expect(text).toContain("corepack enable && yarn install --immutable");
    expect(text).toContain("COPY --from=build /app/.output ./.output");
    expect(text).not.toContain("COPY --from=build /app ./");
  });

  test("the port binds on every interface", () => {
    const snap = snapshot({ scripts: { start: "node ." } });
    const plan = detectAppFrom(snap);
    if (!plan) throw new Error("expected a plan");
    expect(renderDockerfile({ ...plan, port: 8080 }, snap)).toContain(
      "ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 HOSTNAME=0.0.0.0",
    );
  });
});

test("dockerignore keeps env files out of the image", () => {
  const lines = DOCKERIGNORE.split("\n");
  expect(lines).toContain(".env");
  expect(lines).toContain(".env.*");
  expect(lines).toContain("node_modules");
});
