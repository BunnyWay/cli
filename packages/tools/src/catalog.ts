import { UserError } from "@bunny.net/openapi-client";
import type { ToolContext } from "./context.ts";
import type { Tool, ToolKind } from "./define-tool.ts";
import { registriesTools } from "./registries/index.ts";
import { registryTools } from "./registry/index.ts";

function index(all: Tool[]): Map<string, Tool> {
  const map = new Map<string, Tool>();
  for (const tool of all) {
    if (map.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    map.set(tool.name, tool);
  }
  return map;
}

/** Every tool, sorted by name. This is the curated surface a host or agent gets. */
export const tools: readonly Tool[] = Object.freeze(
  [...registriesTools, ...registryTools].sort((a, b) =>
    a.name.localeCompare(b.name),
  ),
);

const byName = index([...tools]);

export function getTool(name: string): Tool | undefined {
  return byName.get(name);
}

export function requireTool(name: string): Tool {
  const tool = getTool(name);
  if (!tool) {
    throw new UserError(
      `Unknown tool "${name}".`,
      `Known tools: ${[...byName.keys()].join(", ")}.`,
    );
  }
  return tool;
}

export interface ToolFilter {
  /** Restrict to one effect kind, e.g. `read` for an unattended agent. Omit for all. */
  kind?: ToolKind;
  /** Dotted prefix, e.g. `registries`. */
  namespace?: string;
  /** `false` excludes tools that touch the local filesystem; for remote hosts. */
  localFiles?: boolean;
}

export function listTools(filter: ToolFilter = {}): Tool[] {
  return tools.filter((tool) => {
    if (filter.kind !== undefined && tool.kind !== filter.kind) return false;
    if (filter.namespace && !tool.name.startsWith(`${filter.namespace}.`)) {
      return false;
    }
    if (
      filter.localFiles !== undefined &&
      Boolean(tool.localFiles) !== filter.localFiles
    ) {
      return false;
    }
    return true;
  });
}

/** Look a tool up by name and invoke it with validation. */
export function runTool(
  name: string,
  ctx: ToolContext,
  input: unknown,
): Promise<unknown> {
  return requireTool(name).invoke(ctx, input);
}
