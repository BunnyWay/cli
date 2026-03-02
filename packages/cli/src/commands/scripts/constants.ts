import type { components } from "@bunny.net/api/generated/compute.d.ts";

type EdgeScriptTypes = components["schemas"]["EdgeScriptTypes"];

export const SCRIPT_MANIFEST = "script.json";

export const SCRIPT_TYPE_LABELS: Record<number, string> = {
  0: "DNS",
  1: "Standalone",
  2: "Middleware",
};

export interface Template {
  name: string;
  description: string;
  repo: string;
  scriptType: EdgeScriptTypes;
}

export const TEMPLATES: Template[] = [
  // Standalone
  { name: "Empty", description: "An empty Edge Script project", repo: "https://github.com/BunnyWay/es-empty-script", scriptType: 1 },
  { name: "Return JSON", description: "A script that returns JSON responses", repo: "https://github.com/BunnyWay/es-return-json", scriptType: 1 },
  // Middleware
  { name: "Empty", description: "An empty Edge Script project", repo: "https://github.com/BunnyWay/es-empty-script", scriptType: 2 },
  { name: "Simple Middleware", description: "A simple middleware example", repo: "https://github.com/BunnyWay/es-simple-middleware", scriptType: 2 },
];
