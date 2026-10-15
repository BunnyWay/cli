import {
  type DetectedApp,
  dockerfile,
  type Project,
  versionFrom,
} from "./project.ts";

export function detectGo(project: Project): DetectedApp | undefined {
  const gomod = project.read("go.mod");
  const rootGo = project.entries.some((e) => e.endsWith(".go"));
  if (gomod === null && !rootGo) return undefined;

  // Build the root package, or else the first `cmd/<name>` with a main.go.
  const cmd = project
    .list("cmd")
    .find((dir) => project.read(`cmd/${dir}/main.go`) !== null);
  const pkg = rootGo ? "." : cmd && `./cmd/${cmd}`;
  if (!pkg) return undefined;

  const name = gomod
    ?.match(/^module\s+(\S+)/m)?.[1]
    ?.split("/")
    .pop();
  const version = versionFrom([gomod], /^go\s+(\d+\.\d+)/m, "1");
  // With a go.mod, download modules before copying the source so they
  // cache. A lone main.go gets a module created for it.
  const modules = gomod
    ? [
        `COPY go.mod${project.entries.includes("go.sum") ? " go.sum" : ""} ./`,
        "RUN go mod download",
        "COPY . .",
      ]
    : ["COPY . .", "RUN go mod init app && go mod tidy"];

  return {
    label: "Go",
    port: 8080,
    name,
    ignore: [],
    dockerfile: (port) =>
      dockerfile("Go", [
        `FROM golang:${version} AS build`,
        "WORKDIR /src",
        ...modules,
        `RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /server ${pkg}`,
        "",
        "FROM gcr.io/distroless/static-debian12",
        "COPY --from=build /server /server",
        `ENV PORT=${port}`,
        `EXPOSE ${port}`,
        'CMD ["/server"]',
      ]),
  };
}
