import { type DetectedApp, dockerfile, type Project } from "./project.ts";

const ENTRIES = ["main.ts", "main.js", "main.mjs", "main.mts", "server.ts"];

export function detectDeno(project: Project): DetectedApp | undefined {
  if (!project.entries.some((e) => e === "deno.json" || e === "deno.jsonc")) {
    return undefined;
  }
  const entry = ENTRIES.find((e) => project.entries.includes(e));
  if (!entry) return undefined;

  return {
    label: "Deno",
    // Deno.serve listens on 8000 on every interface unless told otherwise.
    port: 8000,
    ignore: ["node_modules"],
    dockerfile: (port) =>
      dockerfile("Deno", [
        "FROM denoland/deno:2",
        "WORKDIR /app",
        "COPY . .",
        `RUN deno cache ${entry}`,
        `ENV PORT=${port}`,
        `EXPOSE ${port}`,
        `CMD ["deno", "run", "--allow-all", "${entry}"]`,
      ]),
  };
}
