import { nodeBuildStage } from "./node.ts";
import {
  appName,
  type DetectedApp,
  dockerfile,
  type Project,
  readJson,
  versionFrom,
} from "./project.ts";

export function detectLaravel(project: Project): DetectedApp | undefined {
  const composer = readJson(project, "composer.json");
  const require = (composer?.require ?? {}) as Record<string, string>;
  if (!require["laravel/framework"]) return undefined;

  const php = versionFrom([require.php], /(8\.\d+)/, "8.4");
  // Most Laravel apps bundle frontend assets with Vite into public/build.
  const pkg = readJson(project, "package.json");
  const build = pkg && (pkg.scripts as Record<string, unknown>)?.build;
  const assets = build ? [...nodeBuildStage(project, pkg, "assets"), ""] : [];

  return {
    label: "Laravel",
    port: 8080,
    name: appName(composer?.name),
    ignore: ["vendor", "node_modules", "public/build", "public/hot"],
    dockerfile: (port) =>
      dockerfile("Laravel", [
        ...assets,
        // FrankenPHP serves /app/public; SERVER_NAME=:port serves plain HTTP.
        `FROM dunglas/frankenphp:1-php${php}`,
        "RUN install-php-extensions bcmath intl opcache pcntl pdo_mysql pdo_pgsql zip",
        "COPY --from=composer:2 /usr/bin/composer /usr/bin/composer",
        "WORKDIR /app",
        "COPY . .",
        ...(build
          ? ["COPY --from=assets /app/public/build ./public/build"]
          : []),
        "RUN composer install --no-dev --optimize-autoloader --no-interaction",
        `ENV APP_ENV=production SERVER_NAME=:${port}`,
        `EXPOSE ${port}`,
      ]),
  };
}
