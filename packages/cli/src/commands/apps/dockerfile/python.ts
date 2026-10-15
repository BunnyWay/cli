import {
  type DetectedApp,
  dockerfile,
  type Project,
  versionFrom,
} from "./project.ts";

// Scripts a plain Python app starts from, in order.
const ENTRIES = ["main.py", "app.py", "server.py"];
// Modules that hold a FastAPI or Flask `app`, in order.
const APP_MODULES = [...ENTRIES, "wsgi.py", "app/main.py"];

/** The first of `files` that exists, as a module path (`app/main.py` → `app.main`). */
function moduleOf(project: Project, files: string[]): string | undefined {
  const file = files.find((f) => project.read(f) !== null);
  return file?.replace(/\.py$/, "").replaceAll("/", ".");
}

export function detectPython(project: Project): DetectedApp | undefined {
  const requirements = project.read("requirements.txt");
  const pyproject = project.read("pyproject.toml");
  const entry = ENTRIES.find((f) => project.entries.includes(f));
  const manifest = requirements !== null || pyproject !== null;
  if (!manifest && !entry) return undefined;

  // Dependencies come from the manifest, or for a lone script from what it
  // imports. Whole names only, so `flask` doesn't match `flask-cors`.
  const deps = manifest
    ? `${requirements ?? ""}\n${pyproject ?? ""}`.toLowerCase()
    : [
        ...(project.read(entry ?? "") ?? "").matchAll(
          /^(?:from|import)\s+(\w+)/gm,
        ),
      ]
        .map((m) => m[1])
        .join("\n");
  const has = (name: string) =>
    new RegExp(`(?:^|[\\s"',[])${name}(?![\\w-])`, "m").test(deps);

  let label = "Python";
  let command: (port: number) => string[];
  let packages: string[] = [];
  const gunicorn = (target: string) => (port: number) => [
    "gunicorn",
    target,
    "--bind",
    `0.0.0.0:${port}`,
  ];

  const settings = project
    .read("manage.py")
    ?.match(/DJANGO_SETTINGS_MODULE["'],\s*["']([\w.]+)\.settings["']/)?.[1];
  const fastapi = has("fastapi") && moduleOf(project, APP_MODULES);
  const flask = has("flask") && moduleOf(project, APP_MODULES);
  if (has("django") && settings) {
    label = "Django";
    command = gunicorn(`${settings}.wsgi`);
    packages = ["django", "gunicorn"];
  } else if (fastapi) {
    label = "FastAPI";
    command = (port) => [
      "uvicorn",
      `${fastapi}:app`,
      "--host",
      "0.0.0.0",
      "--port",
      String(port),
    ];
    packages = ["fastapi", "uvicorn"];
  } else if (flask) {
    label = "Flask";
    command = gunicorn(`${flask}:app`);
    packages = ["flask", "gunicorn"];
  } else if (entry) {
    command = () => ["python", entry];
  } else {
    return undefined;
  }

  const version = versionFrom(
    [project.read(".python-version")],
    /(3\.\d+)/,
    "3.13",
  );
  // Install dependencies, plus any framework package the project doesn't
  // list, before copying the source so they cache. A bare pyproject.toml
  // installs the project itself, so it needs the source first.
  const missing = packages.filter((p) => !manifest || !has(p)).join(" ");
  const uv = project.entries.includes("uv.lock");
  const install = uv
    ? [
        "COPY pyproject.toml uv.lock ./",
        `RUN uv sync --frozen --no-dev --no-install-project${missing && ` && uv pip install ${missing}`}`,
        "COPY . .",
      ]
    : requirements !== null
      ? [
          "COPY requirements.txt ./",
          `RUN pip install --no-cache-dir -r requirements.txt ${missing}`.trim(),
          "COPY . .",
        ]
      : pyproject !== null
        ? ["COPY . .", `RUN pip install --no-cache-dir . ${missing}`.trim()]
        : [
            ...(missing ? [`RUN pip install --no-cache-dir ${missing}`] : []),
            "COPY . .",
          ];

  return {
    label,
    port: 8000,
    ignore: ["__pycache__", "*.pyc", ".venv", "venv"],
    dockerfile: (port) =>
      dockerfile(label, [
        `FROM python:${version}-slim`,
        ...(uv
          ? [
              "COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv",
              "ENV PATH=/app/.venv/bin:$PATH",
            ]
          : []),
        "ENV PYTHONUNBUFFERED=1",
        "WORKDIR /app",
        ...install,
        `ENV PORT=${port}`,
        `EXPOSE ${port}`,
        `CMD ${JSON.stringify(command(port))}`,
      ]),
  };
}
