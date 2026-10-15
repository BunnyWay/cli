import { nodeBuildStage } from "./node.ts";
import {
  appName,
  type DetectedApp,
  dockerfile,
  type Project,
  readJson,
  versionFrom,
} from "./project.ts";

// What most frameworks and ORMs need beyond the extensions FrankenPHP ships.
const EXTENSIONS = "bcmath intl opcache pcntl pdo_mysql pdo_pgsql zip";

export function detectPhp(project: Project): DetectedApp | undefined {
  // A front controller to serve: public/index.php (Laravel, Symfony, Slim)
  // or a bare index.php at the root.
  const publicRoot = project.read("public/index.php") !== null;
  if (!publicRoot && !project.entries.includes("index.php")) return undefined;
  const composer = readJson(project, "composer.json");

  const require = (composer?.require ?? {}) as Record<string, string>;
  const [label, env] = require["laravel/framework"]
    ? ["Laravel", "APP_ENV=production "]
    : require["symfony/framework-bundle"]
      ? ["Symfony", "APP_ENV=prod "]
      : ["PHP", ""];
  // FrankenPHP publishes images for PHP 8.2 and later.
  const php = versionFrom([require.php], /(8\.[2-9])/, "8.4");
  // Frontend assets (Vite, Encore) build in a Node stage into public/build.
  const pkg = readJson(project, "package.json");
  const build = pkg && (pkg.scripts as Record<string, unknown>)?.build;

  return {
    label,
    port: 8080,
    name: appName(composer?.name),
    ignore: ["vendor", "node_modules", "public/build", "public/hot"],
    dockerfile: (port) =>
      dockerfile(label, [
        ...(build ? [...nodeBuildStage(project, pkg, "assets"), ""] : []),
        `FROM dunglas/frankenphp:1-php${php}`,
        ...(composer
          ? [
              `RUN install-php-extensions ${EXTENSIONS}`,
              "COPY --from=composer:2 /usr/bin/composer /usr/bin/composer",
            ]
          : []),
        "WORKDIR /app",
        "COPY . .",
        ...(build
          ? ["COPY --from=assets /app/public/build ./public/build"]
          : []),
        // FrankenPHP serves public/ by default; a bare index.php serves the
        // project root. SERVER_NAME=:port serves plain HTTP on that port.
        `ENV ${env}SERVER_NAME=:${port}${publicRoot ? "" : " SERVER_ROOT=/app"}`,
        ...(composer
          ? [
              "RUN composer install --no-dev --optimize-autoloader --no-interaction",
            ]
          : []),
        `EXPOSE ${port}`,
      ]),
  };
}
