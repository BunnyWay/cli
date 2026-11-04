import { UserError } from "@bunny.net/openapi-client";
import type { z } from "zod";
import type { ToolContext } from "./context.ts";

/** Dotted lowercase path, e.g. `registries.list`. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

/** Effect on remote state; `destructive` (deletes or cannot be undone) must be confirmed. */
export type ToolKind = "read" | "write" | "destructive";

export interface ToolDefinition<
  Schema extends z.ZodObject = z.ZodObject,
  Result = unknown,
> {
  name: string;
  title?: string;
  /** Default `--help` description for the command wrapping it. */
  description: string;
  schema: Schema;
  kind: ToolKind;
  /** Declarative; the result is not re-validated against it. */
  resultSchema?: z.ZodType<Result>;
  /** True when the result contains credentials. */
  sensitive?: boolean;
  /** True when the tool reads or writes local files (path inputs, a local journal). */
  localFiles?: boolean;
  examples?: ReadonlyArray<readonly [z.input<Schema>, string]>;
  /** Does the work and returns plain serializable data. Never prints, never prompts. */
  run(ctx: ToolContext, input: z.infer<Schema>): Promise<Result>;
}

export interface Tool<
  Schema extends z.ZodObject = z.ZodObject,
  Result = unknown,
> extends ToolDefinition<Schema, Result> {
  invoke(ctx: ToolContext, input: unknown): Promise<Result>;
}

// A Zod failure becomes a UserError naming the offending fields.
function inputError(name: string, error: z.ZodError): UserError {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
  return new UserError(`Invalid input for "${name}": ${details}.`);
}

/** One unit of bunny.net work; commands wrap it with `defineToolCommand`. */
export function defineTool<Schema extends z.ZodObject, Result>(
  def: ToolDefinition<Schema, Result>,
): Tool<Schema, Result> {
  if (!NAME_PATTERN.test(def.name)) {
    throw new Error(
      `Invalid tool name "${def.name}". Use a dotted lowercase path like "registries.list".`,
    );
  }
  if (!def.description.trim()) {
    throw new Error(`Tool "${def.name}" is missing a description.`);
  }

  return {
    ...def,
    // Async so a validation failure rejects like any other tool error.
    async invoke(ctx, input) {
      const parsed = def.schema.safeParse(input ?? {});
      if (!parsed.success) throw inputError(def.name, parsed.error);
      return def.run(ctx, parsed.data as z.infer<Schema>);
    },
  };
}
