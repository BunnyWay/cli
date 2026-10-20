import { type DetectedApp, dockerfile, type Project } from "./project.ts";

export function detectRust(project: Project): DetectedApp | undefined {
  const sections = project.read("Cargo.toml")?.split(/^\[/m) ?? [];
  const nameIn = (header: string) =>
    sections
      .find((section) => section.startsWith(header))
      ?.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  // The binary: the first named `[[bin]]` target, else `src/main.rs`, named
  // after the package. Library crates and workspaces have neither.
  const name =
    nameIn("[bin]]") ??
    (project.read("src/main.rs") !== null ? nameIn("package]") : undefined);
  if (!name) return undefined;
  const locked = project.entries.includes("Cargo.lock") ? " --locked" : "";

  return {
    label: "Rust",
    port: 8080,
    name,
    ignore: ["target"],
    dockerfile: (port) =>
      dockerfile("Rust", [
        // Same Debian release in both stages, so the binary's glibc matches.
        "FROM rust:1-bookworm AS build",
        "WORKDIR /src",
        "COPY . .",
        `RUN cargo build --release${locked}`,
        "",
        "FROM debian:bookworm-slim",
        "RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*",
        `COPY --from=build /src/target/release/${name} /usr/local/bin/server`,
        `ENV PORT=${port}`,
        `EXPOSE ${port}`,
        'CMD ["server"]',
      ]),
  };
}
