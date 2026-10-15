import {
  type DetectedApp,
  dockerfile,
  type Project,
  versionFrom,
} from "./project.ts";

export function detectRails(project: Project): DetectedApp | undefined {
  const gemfile = project.read("Gemfile");
  if (!gemfile || !/^\s*gem\s+["']rails["']/m.test(gemfile)) return undefined;

  const version = versionFrom(
    [project.read(".ruby-version"), gemfile],
    /^(?:ruby\s+["']|ruby-)?(\d+\.\d+)/m,
    "3.4",
  );
  const lock = project.entries.includes("Gemfile.lock") ? " Gemfile.lock" : "";
  // API-only apps have no asset pipeline to precompile.
  const assets = /^\s*gem\s+["'](propshaft|sprockets-rails)["']/m.test(gemfile);

  return {
    label: "Rails",
    port: 3000,
    ignore: ["log", "tmp", "node_modules", "storage", ".bundle"],
    dockerfile: (port) =>
      dockerfile("Rails", [
        `FROM ruby:${version}-slim`,
        "RUN apt-get update && apt-get install -y --no-install-recommends build-essential git libpq-dev libyaml-dev pkg-config && rm -rf /var/lib/apt/lists/*",
        "WORKDIR /app",
        "ENV RAILS_ENV=production BUNDLE_WITHOUT=development:test",
        `COPY Gemfile${lock} ./`,
        "RUN bundle install",
        "COPY . .",
        ...(assets
          ? ["RUN SECRET_KEY_BASE_DUMMY=1 bin/rails assets:precompile"]
          : []),
        `ENV PORT=${port}`,
        `EXPOSE ${port}`,
        `CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "${port}"]`,
      ]),
  };
}
