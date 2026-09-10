import { z } from "zod";
import type { Tool } from "./define-tool.ts";

/** JSON Schema for a tool's input, for hosts that describe tools to a model or validate wire arguments. */
export function inputJsonSchema(tool: Tool): Record<string, unknown> {
  return z.toJSONSchema(tool.schema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;
}

/**
 * JSON Schema for a tool's result, or undefined when it declares no
 * `resultSchema`. Non-object results are wrapped as `{ result }`, since most
 * tool protocols require structured output to be a JSON object.
 */

function wrapsResult(tool: Tool): boolean {
  if (!tool.resultSchema) return false;

  const schema = z.toJSONSchema(tool.resultSchema, {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;

  return schema.type !== "object";
}

export function outputJsonSchema(
  tool: Tool,
): Record<string, unknown> | undefined {
  if (!tool.resultSchema) return undefined;
  const schema = z.toJSONSchema(tool.resultSchema, {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;
  if (!wrapsResult(tool)) return schema;
  return {
    type: "object",
    properties: { result: schema },
    required: ["result"],
    additionalProperties: false,
  };
}

/** Wrap a result to match {@link outputJsonSchema}, so payload and schema agree. */
export function toStructuredResult(
  tool: Tool,
  result: unknown,
): Record<string, unknown> | undefined {
  if (!tool.resultSchema) return undefined;

  if (wrapsResult(tool)) return { result };

  return result as Record<string, unknown>;
}

/** The description plus the caveats a caller needs in prose, for hosts whose tool format has no field for them. */
export function describeTool(tool: Tool): string {
  let text = tool.description;
  if (tool.sensitive) {
    text +=
      "\n\nThe result contains credentials. Treat it as a secret: do not log it or echo it back unprompted.";
  }
  if (tool.localFiles) {
    text +=
      "\n\nReads or writes the local filesystem, so path arguments refer to the machine this runs on.";
  }
  if (tool.examples?.length) {
    const lines = tool.examples.map(
      ([input, description]) => `- ${description}: ${JSON.stringify(input)}`,
    );
    text += `\n\nExamples:\n${lines.join("\n")}`;
  }
  return text;
}

/** Flatten a dotted name for hosts that disallow dots: `registries.list` with prefix `bunny` becomes `bunny_registries_list`. */
export function flatName(tool: Tool, prefix?: string): string {
  const suffix = tool.name.replaceAll(".", "_");
  return prefix ? `${prefix}_${suffix}` : suffix;
}
