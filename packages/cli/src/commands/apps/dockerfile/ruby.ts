import {
  type DetectedApp,
  dockerfile,
  type Project,
  versionFrom,
} from "./project.ts";

const gem = (gemfile: string, name: string) =>
  new RegExp(`^\\s*gem\\s+["']${name}["']`, "m").test(gemfile);

export function detectRuby(project: Project): DetectedApp | undefined {
  const gemfile = project.read("Gemfile");
  if (!gemfile) return undefined;

  const rails = gem(gemfile, "rails");
  // Rack apps (Sinatra, Roda, Hanami) start from config.ru.
  if (!rails && !project.entries.includes("config.ru")) return undefined;

  const label = rails ? "Rails" : gem(gemfile, "sinatra") ? "Sinatra" : "Rack";
  const version = versionFrom(
    [project.read(".ruby-version"), gemfile],
    /^(?:ruby\s+["']|ruby-)?(\d+\.\d+)/m,
    "3.4",
  );
  const lock = project.entries.includes("Gemfile.lock") ? " Gemfile.lock" : "";
  // API-only apps have no asset pipeline to precompile.
  const assets =
    rails && (gem(gemfile, "propshaft") || gem(gemfile, "sprockets-rails"));
  const start = (port: number) =>
    rails
      ? ["bin/rails", "server", "-b", "0.0.0.0", "-p", String(port)]
      : gem(gemfile, "puma")
        ? ["bundle", "exec", "puma", "-b", `tcp://0.0.0.0:${port}`]
        : ["bundle", "exec", "rackup", "-o", "0.0.0.0", "-p", String(port)];

  return {
    label,
    port: rails ? 3000 : 9292,
    ignore: ["log", "tmp", "node_modules", "storage", ".bundle"],
    dockerfile: (port) =>
      dockerfile(label, [
        `FROM ruby:${version}-slim`,
        "RUN apt-get update && apt-get install -y --no-install-recommends build-essential git libpq-dev libyaml-dev pkg-config && rm -rf /var/lib/apt/lists/*",
        "WORKDIR /app",
        `ENV ${rails ? "RAILS_ENV" : "RACK_ENV"}=production BUNDLE_WITHOUT=development:test`,
        `COPY Gemfile${lock} ./`,
        "RUN bundle install",
        "COPY . .",
        ...(assets
          ? ["RUN SECRET_KEY_BASE_DUMMY=1 bin/rails assets:precompile"]
          : []),
        `ENV PORT=${port}`,
        `EXPOSE ${port}`,
        `CMD ${JSON.stringify(start(port))}`,
      ]),
  };
}
