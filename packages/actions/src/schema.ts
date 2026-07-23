import { z } from "zod";
import type { Action } from "./define-action.ts";

/**
 * JSON Schema for an action's input, for hosts that describe actions to a model
 * or validate arguments arriving off the wire.
 */
export function inputJsonSchema(action: Action): Record<string, unknown> {
  return z.toJSONSchema(action.schema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;
}

/**
 * JSON Schema for an action's result, or undefined when it declares no
 * `resultSchema`. Non-object results are wrapped as `{ result }`, since most
 * tool protocols require structured output to be a JSON object.
 */
export function outputJsonSchema(
  action: Action,
): Record<string, unknown> | undefined {
  if (!action.resultSchema) return undefined;
  const schema = z.toJSONSchema(action.resultSchema, {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;
  if (schema.type === "object") return schema;
  return {
    type: "object",
    properties: { result: schema },
    required: ["result"],
    additionalProperties: false,
  };
}

/** Wrap a result to match {@link outputJsonSchema}, so payload and schema agree. */
export function toStructuredResult(
  action: Action,
  result: unknown,
): Record<string, unknown> | undefined {
  if (!action.resultSchema) return undefined;
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
}

/**
 * The action's description plus the caveats a caller needs in prose, for hosts
 * whose tool format has no field for them.
 */
export function describeAction(action: Action): string {
  let text = action.description;
  if (action.sensitive) {
    text +=
      "\n\nThe result contains credentials. Treat it as a secret: do not log it or echo it back unprompted.";
  }
  if (action.localFiles) {
    text +=
      "\n\nReads or writes the local filesystem, so path arguments refer to the machine this runs on.";
  }
  if (action.examples?.length) {
    const lines = action.examples.map(
      ([input, description]) => `- ${description}: ${JSON.stringify(input)}`,
    );
    text += `\n\nExamples:\n${lines.join("\n")}`;
  }
  return text;
}

/**
 * Flatten a dotted action name for hosts that disallow dots in tool names:
 * `storage.zones.list` with prefix `bunny` becomes `bunny_storage_zones_list`.
 */
export function flatName(action: Action, prefix?: string): string {
  const suffix = action.name.replace(/\./g, "_");
  return prefix ? `${prefix}_${suffix}` : suffix;
}
