import {
  type DetectedApp,
  dockerfile,
  type Project,
  versionFrom,
} from "./project.ts";

export function detectGo(project: Project): DetectedApp | undefined {
  const gomod = project.read("go.mod");
  if (!gomod) return undefined;

  // Build the root package, or the `cmd/<module name>` layout.
  const module = gomod
    .match(/^module\s+(\S+)/m)?.[1]
    ?.split("/")
    .pop();
  const pkg = project.entries.some((e) => e.endsWith(".go"))
    ? "."
    : module && project.read(`cmd/${module}/main.go`) !== null
      ? `./cmd/${module}`
      : undefined;
  if (!pkg) return undefined;

  const version = versionFrom([gomod], /^go\s+(\d+\.\d+)/m, "1");
  const sum = project.entries.includes("go.sum") ? " go.sum" : "";

  return {
    label: "Go",
    port: 8080,
    name: module,
    ignore: [],
    dockerfile: (port) =>
      dockerfile("Go", [
        `FROM golang:${version} AS build`,
        "WORKDIR /src",
        `COPY go.mod${sum} ./`,
        "RUN go mod download",
        "COPY . .",
        `RUN CGO_ENABLED=0 go build -o /server ${pkg}`,
        "",
        "FROM gcr.io/distroless/static-debian12",
        "COPY --from=build /server /server",
        `ENV PORT=${port}`,
        `EXPOSE ${port}`,
        'CMD ["/server"]',
      ]),
  };
}
