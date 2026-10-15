import { type DetectedApp, dockerfile, type Project } from "./project.ts";

export function detectRust(project: Project): DetectedApp | undefined {
  // The binary is named after `[package]`; workspaces have no single one.
  const name = project
    .read("Cargo.toml")
    ?.match(/^\[package\][^[]*?^name\s*=\s*"([^"]+)"/m)?.[1];
  if (!name) return undefined;
  const locked = project.entries.includes("Cargo.lock") ? " --locked" : "";

  return {
    label: "Rust",
    port: 8080,
    name,
    ignore: ["target"],
    dockerfile: (port) =>
      dockerfile("Rust", [
        "FROM rust:1 AS build",
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
