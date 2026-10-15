import { describe, expect, test } from "bun:test";
import { type DetectedApp, detectAppFrom, dockerignore } from "./index.ts";

/** A project root holding `files`; JSON values are serialised. */
function detect(files: Record<string, unknown>): DetectedApp | undefined {
  return detectAppFrom({
    entries: Object.keys(files).map((path) => path.split("/")[0] ?? path),
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

describe("node", () => {
  test("Next.js caches deps, builds, and runs next start", () => {
    const app = detect({
      "package.json": {
        name: "@acme/web",
        scripts: { build: "next build" },
        dependencies: { next: "15.0.0" },
      },
      "package-lock.json": "",
    });
    expect(app).toMatchObject({ label: "Next.js", port: 3000, name: "web" });
    const lines = app?.dockerfile(3000).split("\n") ?? [];
    expect(lines.indexOf("RUN npm ci")).toBeGreaterThan(
      lines.indexOf("COPY package.json package-lock.json ./"),
    );
    expect(lines).toContain("RUN npm run build");
    expect(lines).toContain('CMD ["node_modules/.bin/next","start"]');
  });

  test("a frontend without a server adapter is a site, not an app", () => {
    expect(
      detect({ "package.json": { dependencies: { astro: "5" } } }),
    ).toBeUndefined();
    expect(
      detect({
        "package.json": {
          scripts: { start: "react-scripts start" },
          dependencies: { "react-scripts": "5" },
        },
      }),
    ).toBeUndefined();
    expect(
      detect({
        "package.json": { dependencies: { astro: "5", "@astrojs/node": "9" } },
      }),
    ).toMatchObject({ label: "Astro", port: 4321 });
  });

  test("a frontend with its own server runs the server", () => {
    expect(
      detect({
        "package.json": {
          scripts: { start: "node server.js" },
          dependencies: { express: "5", vite: "6" },
        },
      })?.label,
    ).toBe("Node.js");
  });

  test("bun runs node commands with bun", () => {
    const dockerfile = render({
      "package.json": { dependencies: { nuxt: "3" } },
      "bun.lock": "",
    });
    expect(dockerfile).toContain("FROM oven/bun:1");
    expect(dockerfile).toContain('CMD ["bun",".output/server/index.mjs"]');
    expect(dockerfile).toContain("COPY --from=build /app/.output ./.output");
  });

  test.each([
    [{ ".nvmrc": "v20.11.0\n" }, "node:20-slim"],
    [{}, "node:24-slim"],
  ])("node version from %j", (extra, image) => {
    expect(
      render({ "package.json": { scripts: { start: "node ." } }, ...extra }),
    ).toContain(`FROM ${image}`);
  });

  test("nothing to start is not an app", () => {
    expect(
      detect({ "package.json": { scripts: { test: "bun test" } } }),
    ).toBeUndefined();
  });
});

describe("python", () => {
  test("Django runs its WSGI module under gunicorn", () => {
    const dockerfile = render({
      "requirements.txt": "Django==5.1\ndjango-environ\n",
      "manage.py":
        'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")',
    });
    expect(dockerfile).toContain(
      "RUN pip install --no-cache-dir -r requirements.txt gunicorn",
    );
    expect(dockerfile).toContain(
      'CMD ["gunicorn","mysite.wsgi","--bind","0.0.0.0:8000"]',
    );
  });

  test("FastAPI with uv runs uvicorn from the venv", () => {
    const dockerfile = render({
      "pyproject.toml": 'dependencies = ["fastapi[standard]", "uvicorn"]',
      "uv.lock": "",
      "app/main.py": "",
    });
    expect(dockerfile).toContain(
      "RUN uv sync --frozen --no-dev --no-install-project\n",
    );
    expect(dockerfile).toContain(
      'CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]',
    );
  });

  test("a package that merely starts with a framework name doesn't count", () => {
    expect(
      detect({ "requirements.txt": "flask-cors\n", "app.py": "" }),
    ).toBeUndefined();
  });
});

describe("go", () => {
  test("builds the cmd/<module> layout into a distroless image", () => {
    const dockerfile = render({
      "go.mod": "module github.com/acme/api\n\ngo 1.23.4\n",
      "go.sum": "",
      "cmd/api/main.go": "package main",
    });
    expect(dockerfile).toContain("FROM golang:1.23 AS build");
    expect(dockerfile).toContain("COPY go.mod go.sum ./");
    expect(dockerfile).toContain(
      "RUN CGO_ENABLED=0 go build -o /server ./cmd/api",
    );
  });

  test("no main package is not an app", () => {
    expect(detect({ "go.mod": "module example.com/lib\n" })).toBeUndefined();
  });
});

describe("rust", () => {
  test("ships the package binary", () => {
    const dockerfile = render({
      "Cargo.toml": '[package]\nname = "api"\nversion = "0.1.0"\n',
      "Cargo.lock": "",
    });
    expect(dockerfile).toContain("RUN cargo build --release --locked");
    expect(dockerfile).toContain(
      "/src/target/release/api /usr/local/bin/server",
    );
  });
});

describe("rails", () => {
  test("wins over the package.json next to it", () => {
    const dockerfile = render({
      Gemfile: 'ruby "3.3.0"\ngem "rails", "~> 8.0"\ngem "propshaft"\n',
      "Gemfile.lock": "",
      "package.json": { scripts: { start: "node ." } },
    });
    expect(dockerfile).toContain("FROM ruby:3.3-slim");
    expect(dockerfile).toContain("bin/rails assets:precompile");
    expect(dockerfile).toContain('"-b", "0.0.0.0", "-p", "3000"');
  });
});

describe("laravel", () => {
  test("builds Vite assets and serves with FrankenPHP", () => {
    const app = detect({
      "composer.json": {
        name: "acme/shop",
        require: { php: "^8.3", "laravel/framework": "^12.0" },
      },
      "package.json": { scripts: { build: "vite build" } },
      "package-lock.json": "",
    });
    expect(app).toMatchObject({ label: "Laravel", name: "shop" });
    const dockerfile = app?.dockerfile(8080) ?? "";
    expect(dockerfile).toContain("AS assets\n");
    expect(dockerfile).toContain("FROM dunglas/frankenphp:1-php8.3");
    expect(dockerfile).toContain("SERVER_NAME=:8080");
  });
});

test("dockerignore keeps env files out and adds the stack's own lines", () => {
  const app = detect({ "Cargo.toml": '[package]\nname = "api"\n' });
  if (!app) throw new Error("expected an app");
  const lines = dockerignore(app).split("\n");
  expect(lines).toContain(".env");
  expect(lines).toContain(".env.*");
  expect(lines).toContain("target");
});
