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

  test("a Next.js static export is a site, not an app", () => {
    expect(
      detect({
        "package.json": { dependencies: { next: "15" } },
        "next.config.mjs": 'export default { output: "export" };',
      }),
    ).toBeUndefined();
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

  test("a script next to index.html is a static site's browser code", () => {
    expect(detect({ "index.html": "", "main.js": "" })).toBeUndefined();
  });

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

  test("pnpm leaves unapproved dependency builds unbuilt instead of failing", () => {
    expect(
      render({
        "package.json": { dependencies: { next: "15" } },
        "pnpm-lock.yaml": "",
      }),
    ).toContain(
      "RUN corepack enable && pnpm install --frozen-lockfile --config.strict-dep-builds=false\n",
    );
  });

  test("a lone script runs on bun", () => {
    expect(render({ "index.ts": "Bun.serve({})" })).toContain(
      'CMD ["bun", "index.ts"]',
    );
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
      "RUN uv sync --frozen --no-dev --no-install-project\nCOPY . .\nRUN uv sync --frozen --no-dev --inexact\n",
    );
    expect(dockerfile).toContain(
      'CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]',
    );
  });

  test("a package that merely starts with a framework name doesn't count", () => {
    expect(
      detect({ "requirements.txt": "flask-cors\n", "app.py": "" })?.label,
    ).toBe("Python");
  });

  test("a lone script installs the framework it imports", () => {
    const dockerfile = render({
      "main.py": "from fastapi import FastAPI\napp = FastAPI()\n",
    });
    expect(dockerfile).toContain(
      "RUN pip install --no-cache-dir fastapi uvicorn",
    );
    expect(dockerfile).toContain('"main:app"');
  });

  test("Flask in server.py runs under gunicorn, not its dev server", () => {
    expect(
      render({ "requirements.txt": "flask\n", "server.py": "" }),
    ).toContain('CMD ["gunicorn","server:app","--bind","0.0.0.0:8000"]');
  });

  test("a lone script with no framework runs with python", () => {
    expect(render({ "server.py": "import http.server" })).toContain(
      'CMD ["python","server.py"]',
    );
  });
});

describe("go", () => {
  test("builds the cmd/<module> layout into a distroless image", () => {
    const dockerfile = render({
      "go.mod": "module github.com/acme/api\n\ngo 1.23.4\n",
      "doc.go": "package api",
      "go.sum": "",
      "cmd/api/main.go": "package main",
    });
    expect(dockerfile).toContain("FROM golang:1.23 AS build");
    expect(dockerfile).toContain("COPY go.mod go.sum ./");
    expect(dockerfile).toContain("-o /server ./cmd/api");
  });

  test("a lone main.go gets a module", () => {
    const dockerfile = render({ "main.go": "package main\n" });
    expect(dockerfile).toContain("RUN go mod init app && go mod tidy");
    expect(dockerfile).toContain("-o /server .");
  });

  test("a library is not an app", () => {
    expect(
      detect({ "go.mod": "module example.com/lib\n", "lib.go": "package lib" }),
    ).toBeUndefined();
  });
});

describe("rust", () => {
  test("ships the package binary", () => {
    const dockerfile = render({
      "Cargo.toml":
        '[package]\nauthors = ["a"]\nname = "api"\n\n[dependencies]\nname = "x"\n',
      "Cargo.lock": "",
      "src/main.rs": "fn main() {}",
    });
    expect(dockerfile).toContain("RUN cargo build --release --locked");
    expect(dockerfile).toContain(
      "/src/target/release/api /usr/local/bin/server",
    );
  });

  test("ships a named [[bin]] target", () => {
    expect(
      render({
        "Cargo.toml":
          '[package]\nname = "api"\n\n[[bin]]\nname = "server-bin"\n',
      }),
    ).toContain("/src/target/release/server-bin ");
  });

  test("a library crate is not an app", () => {
    expect(
      detect({
        "Cargo.toml": '[package]\nname = "lib"\n',
        "src/lib.rs": "",
      }),
    ).toBeUndefined();
  });
});

describe("ruby", () => {
  test("wins over the package.json next to it", () => {
    const dockerfile = render({
      Gemfile: 'ruby "3.3.0"\ngem "rails", "~> 8.0"\ngem "propshaft"\n',
      "Gemfile.lock": "",
      "package.json": { scripts: { start: "node ." } },
    });
    expect(dockerfile).toContain("FROM ruby:3.3-slim");
    expect(dockerfile).toContain("bin/rails assets:precompile");
    expect(dockerfile).toContain('"-b","0.0.0.0","-p","3000"');
  });

  test("Rails with mysql2 gets the MySQL client headers", () => {
    expect(render({ Gemfile: 'gem "rails"\ngem "mysql2"\n' })).toContain(
      "default-libmysqlclient-dev",
    );
  });

  test("a Rack app with no server in the bundle is not an app", () => {
    expect(
      detect({ Gemfile: 'gem "sinatra"\n', "config.ru": "run App" }),
    ).toBeUndefined();
  });

  test("Sinatra starts config.ru with puma", () => {
    const app = detect({
      Gemfile: 'gem "sinatra"\ngem "puma"\n',
      "config.ru": "run Sinatra::Application",
    });
    expect(app?.label).toBe("Sinatra");
    expect(app?.dockerfile(9292)).toContain(
      'CMD ["bundle","exec","puma","-b","tcp://0.0.0.0:9292"]',
    );
  });
});

describe("php", () => {
  test("Laravel builds Vite assets and serves public/ with FrankenPHP", () => {
    const app = detect({
      "public/index.php": "",
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
    expect(dockerfile).toContain("ENV APP_ENV=production SERVER_NAME=:8080\n");
  });

  test("PHP older than FrankenPHP supports falls back to the default", () => {
    expect(
      render({
        "index.php": "",
        "composer.json": { require: { php: "^8.1" } },
      }),
    ).toContain("FROM dunglas/frankenphp:1-php8.4");
  });

  test("plain PHP skips the asset stage, which only Laravel and Symfony fit", () => {
    expect(
      render({
        "index.php": "",
        "package.json": { scripts: { build: "tsc" } },
      }),
    ).not.toContain("AS assets");
  });

  test("a lone index.php serves the project root without composer", () => {
    const dockerfile = render({ "index.php": "<?php echo 'hi';" });
    expect(dockerfile).toContain("ENV SERVER_NAME=:8080 SERVER_ROOT=/app");
    expect(dockerfile).not.toContain("composer");
  });
});

describe("dotnet", () => {
  test("publishes a web project and runs its assembly", () => {
    const dockerfile = render({
      "Api.csproj":
        '<Project Sdk="Microsoft.NET.Sdk.Web"><TargetFramework>net9.0</TargetFramework></Project>',
      "global.json": "{}",
    });
    expect(dockerfile).toContain(
      "FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build",
    );
    expect(dockerfile).toContain("COPY Api.csproj global.json ./");
    expect(dockerfile).toContain("ENV ASPNETCORE_URLS=http://+:8080");
    expect(dockerfile).toContain('CMD ["dotnet","Api.dll"]');
  });

  test("the SDK follows global.json while the runtime follows the target", () => {
    const dockerfile = render({
      "Api.csproj":
        '<Project Sdk="Microsoft.NET.Sdk.Web"><TargetFramework>net8.0</TargetFramework></Project>',
      "global.json": '{ "sdk": { "version": "9.0.100" } }',
    });
    expect(dockerfile).toContain(
      "FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build",
    );
    expect(dockerfile).toContain("FROM mcr.microsoft.com/dotnet/aspnet:8.0");
  });

  test("project references restore from the whole tree", () => {
    expect(
      render({
        "Api.csproj":
          '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><ProjectReference Include="Core/Core.csproj" /></ItemGroup></Project>',
      }),
    ).toContain(
      "WORKDIR /src\nCOPY . .\nRUN dotnet restore Api.csproj\nRUN dotnet publish",
    );
  });

  test("Blazor WebAssembly is a static site", () => {
    expect(
      detect({
        "App.csproj": '<Project Sdk="Microsoft.NET.Sdk.BlazorWebAssembly" />',
      }),
    ).toBeUndefined();
  });
});

describe("java", () => {
  test("Spring Boot with the Gradle wrapper skips the plain jar", () => {
    const dockerfile = render({
      "build.gradle.kts":
        'plugins { id("org.springframework.boot") }\njava { toolchain { languageVersion = JavaLanguageVersion.of(17) } }',
      gradlew: "",
    });
    expect(dockerfile).toContain("FROM eclipse-temurin:17-jdk AS build");
    expect(dockerfile).toContain("RUN sh gradlew bootJar");
    expect(dockerfile).toContain("grep -v -- -plain.jar");
    expect(dockerfile).toContain("FROM eclipse-temurin:17-jre");
  });

  test.each([
    ["<java.version>8</java.version>"],
    ["<java.version>1.8</java.version>"],
  ])("Java 8 from %s", (version) => {
    expect(
      render({ "pom.xml": `org.springframework.boot ${version}` }),
    ).toContain("FROM eclipse-temurin:8-jre");
  });

  test("Maven without a wrapper builds on the Maven image", () => {
    expect(
      render({ "pom.xml": "<parent>org.springframework.boot</parent>" }),
    ).toContain("FROM maven:3-eclipse-temurin-21 AS build");
  });
});

describe("deno", () => {
  test("runs the main module", () => {
    expect(render({ "deno.json": "{}", "main.ts": "" })).toContain(
      'CMD ["deno", "run", "--allow-all", "main.ts"]',
    );
  });
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
