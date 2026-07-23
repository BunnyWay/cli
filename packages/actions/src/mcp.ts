import { z } from "zod";
import type { Action } from "./define-action.ts";
import { actions as allActions } from "./registry.ts";

/**
 * An MCP `tools/list` entry. Structural, not typed against the MCP SDK, so this
 * package stays dependency-free; a server can hand these straight to the SDK.
 */
export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title?: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
}

const DEFAULT_PREFIX = "bunny";

/** `storage.zones.list` → `bunny_storage_zones_list`. */
export function toolNameForAction(
  action: Action,
  prefix = DEFAULT_PREFIX,
): string {
  const suffix = action.name.replace(/\./g, "_");
  return prefix ? `${prefix}_${suffix}` : suffix;
}

// MCP has no examples field, so they ride along in the description where the model reads them.
function describe(action: Action): string {
  if (!action.examples?.length) return action.description;
  const lines = action.examples.map(
    ([input, description]) => `- ${description}: ${JSON.stringify(input)}`,
  );
  return `${action.description}\n\nExamples:\n${lines.join("\n")}`;
}

export function toMcpTool(action: Action, prefix = DEFAULT_PREFIX): McpTool {
  return {
    name: toolNameForAction(action, prefix),
    title: action.title,
    description: describe(action),
    inputSchema: z.toJSONSchema(action.schema, {
      target: "draft-2020-12",
      io: "input",
    }) as Record<string, unknown>,
    annotations: {
      title: action.title,
      readOnlyHint: !action.destructive,
      destructiveHint: action.destructive,
      openWorldHint: true,
    },
  };
}

export function toMcpTools(
  opts: { prefix?: string; actions?: readonly Action[] } = {},
): McpTool[] {
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  return (opts.actions ?? allActions).map((action) =>
    toMcpTool(action, prefix),
  );
}

/** Resolve an incoming `tools/call` name back to the action that serves it. */
export function actionForToolName(
  name: string,
  opts: { prefix?: string; actions?: readonly Action[] } = {},
): Action | undefined {
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  return (opts.actions ?? allActions).find(
    (action) => toolNameForAction(action, prefix) === name,
  );
}
