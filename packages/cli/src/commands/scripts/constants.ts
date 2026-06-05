import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";

export type EdgeScriptTypes = components["schemas"]["EdgeScriptTypes"];

export const SCRIPT_MANIFEST = "script.json";

export const SCRIPT_TYPE_DNS: EdgeScriptTypes = 0;
export const SCRIPT_TYPE_STANDALONE: EdgeScriptTypes = 1;
export const SCRIPT_TYPE_MIDDLEWARE: EdgeScriptTypes = 2;

export const SCRIPT_TYPE_LABELS: Record<number, string> = {
  [SCRIPT_TYPE_DNS]: "DNS",
  [SCRIPT_TYPE_STANDALONE]: "Standalone",
  [SCRIPT_TYPE_MIDDLEWARE]: "Middleware",
};

/** Human label for a script type, falling back to "Unknown". */
export function scriptTypeLabel(type: number | null | undefined): string {
  return SCRIPT_TYPE_LABELS[type ?? -1] ?? "Unknown";
}

/** Map a `standalone`/`middleware` string to its script type, or undefined. */
export function parseScriptType(
  value: string | undefined,
): EdgeScriptTypes | undefined {
  if (value === "standalone") return SCRIPT_TYPE_STANDALONE;
  if (value === "middleware") return SCRIPT_TYPE_MIDDLEWARE;
  return undefined;
}

export interface Template {
  name: string;
  description: string;
  repo: string;
  scriptType: EdgeScriptTypes;
}

export const TEMPLATES: Template[] = [
  // Standalone
  {
    name: "Empty",
    description: "An empty Edge Script project",
    repo: "https://github.com/BunnyWay/es-empty-script",
    scriptType: SCRIPT_TYPE_STANDALONE,
  },
  {
    name: "Return JSON",
    description: "A script that returns JSON responses",
    repo: "https://github.com/BunnyWay/es-return-json",
    scriptType: SCRIPT_TYPE_STANDALONE,
  },
  // Middleware
  {
    name: "Empty",
    description: "An empty Edge Script project",
    repo: "https://github.com/BunnyWay/es-empty-script",
    scriptType: SCRIPT_TYPE_MIDDLEWARE,
  },
  {
    name: "Simple Middleware",
    description: "A simple middleware example",
    repo: "https://github.com/BunnyWay/es-simple-middleware",
    scriptType: SCRIPT_TYPE_MIDDLEWARE,
  },
];
