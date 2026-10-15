import {
  type DetectedApp,
  dockerfile,
  type Project,
  versionFrom,
} from "./project.ts";

/** The first of `files` that exists, as a Python module path (`app/main.py` → `app.main`). */
function moduleOf(project: Project, files: string[]): string | undefined {
  const file = files.find((f) => project.read(f) !== null);
  return file?.replace(/\.py$/, "").replaceAll("/", ".");
}

export function detectPython(project: Project): DetectedApp | undefined {
  const requirements = project.read("requirements.txt");
  const pyproject = project.read("pyproject.toml");
  if (requirements === null && pyproject === null) return undefined;

  const deps = `${requirements ?? ""}\n${pyproject ?? ""}`.toLowerCase();
  // A whole package name, so `flask` doesn't match `flask-cors`.
  const has = (name: string) =>
    new RegExp(`(?:^|[\\s"',[])${name}(?![\\w-])`, "m").test(deps);

  let label: string;
  let server: "gunicorn" | "uvicorn";
  let target: string | undefined;
  if (has("django")) {
    label = "Django";
    server = "gunicorn";
    // manage.py names the settings module, e.g. `mysite.settings`.
    const settings = project
      .read("manage.py")
      ?.match(/DJANGO_SETTINGS_MODULE["'],\s*["']([\w.]+)\.settings["']/)?.[1];
    target = settings && `${settings}.wsgi`;
  } else if (has("fastapi")) {
    label = "FastAPI";
    server = "uvicorn";
    const module = moduleOf(project, ["main.py", "app.py", "app/main.py"]);
    target = module && `${module}:app`;
  } else if (has("flask")) {
    label = "Flask";
    server = "gunicorn";
    const module = moduleOf(project, ["app.py", "wsgi.py", "main.py"]);
    target = module && `${module}:app`;
  } else {
    return undefined;
  }
  if (!target) return undefined;

  const version = versionFrom(
    [project.read(".python-version")],
    /(3\.\d+)/,
    "3.13",
  );
  const uv = project.entries.includes("uv.lock");
  // Install dependencies (plus the server, when the project doesn't pin
  // it) before copying the source so they cache. A bare pyproject.toml
  // installs the project itself, so it needs the source first.
  const extra = has(server) ? "" : ` ${server}`;
  const install = uv
    ? [
        "COPY pyproject.toml uv.lock ./",
        `RUN uv sync --frozen --no-dev --no-install-project${extra && ` && uv pip install${extra}`}`,
        "COPY . .",
      ]
    : requirements !== null
      ? [
          "COPY requirements.txt ./",
          `RUN pip install --no-cache-dir -r requirements.txt${extra}`,
          "COPY . .",
        ]
      : ["COPY . .", `RUN pip install --no-cache-dir .${extra}`];
  const bind = (port: number) =>
    server === "gunicorn"
      ? ["gunicorn", target, "--bind", `0.0.0.0:${port}`]
      : ["uvicorn", target, "--host", "0.0.0.0", "--port", String(port)];

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
        `CMD ${JSON.stringify(bind(port))}`,
      ]),
  };
}
