import { describe, expect, test } from "bun:test";
import { type DetectedApp, detectAppFrom, dockerignore } from "./index.ts";

/** A project root holding `files`; JSON values are serialised. */
function detect(files: Record<string, unknown>): DetectedApp | undefined {
  const list = (dir: string) => {
    const prefix = dir ? `${dir}/` : "";
    const names = Object.keys(files)
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length).split("/")[0] ?? "");
    return [...new Set(names)];
  };
  return detectAppFrom({
    entries: list(""),
    list,
    read: (path) => {
      const value = files[path];
      if (value === undefined) return null;
      return typeof value === "string" ? value : JSON.stringify(value);
    },
  });
}

/** Detect and render at the default port, failing when nothing is detected. */
function render(files: Record<string, unknown>): string {
  const app = detect(files);
  if (!app) throw new Error("expected an app");
  return app.dockerfile(app.port);
}

test("install config, which can hold registry tokens, never reaches the runtime", () => {
  const lines = render({
    "package.json": {
      scripts: { build: "next build" },
      dependencies: { next: "15" },
    },
    ".npmrc": "//npm.pkg.github.com/:_authToken=secret",
  }).split("\n");
  expect(lines.indexOf("RUN rm -f .npmrc")).toBeGreaterThan(
    lines.indexOf("RUN npm run build"),
  );
  expect(lines.indexOf("RUN rm -f .npmrc")).toBeLessThan(
    lines.indexOf("COPY --from=build /app ./"),
  );
});

test("dockerignore keeps env files and bunny config out, plus the stack's own lines", () => {
  const app = detect({
    "Cargo.toml": '[package]\nname = "api"\n',
    "src/main.rs": "",
  });
  if (!app) throw new Error("expected an app");
  const lines = (dockerignore(app) ?? "").split("\n");
  expect(lines).toContain(".env");
  expect(lines).toContain(".env.*");
  expect(lines).toContain("bunny.jsonc");
  expect(lines).toContain("target");
});

describe("an existing dockerignore", () => {
  const app = detect({ "index.php": "" });
  if (!app) throw new Error("expected an app");

  test("keeps the user's entries and adds the missing private ones", () => {
    expect(dockerignore(app, "node_modules\n.env\n")).toBe(
      "node_modules\n.env\n\n# Added by the bunny CLI: keep secrets and bunny config out of the image.\n.env.*\nbunny.jsonc\n.bunny\n!.env.example\n",
    );
  });

  test("is left alone when it already covers them", () => {
    expect(
      dockerignore(app, ".env\n.env.*\nbunny.jsonc\n.bunny\n"),
    ).toBeUndefined();
  });
});
