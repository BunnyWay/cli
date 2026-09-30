import { UserError } from "@bunny.net/openapi-client";
import type { z } from "zod";
import type { ToolContext } from "./context.ts";

/** Dotted lowercase path, e.g. `registries.list`. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

/**
 * What a tool does to remote state, from the host's point of view.
 *
 * - `read` touches nothing; safe to run unattended.
 * - `write` creates or updates remote state; invoking it is normally intent enough.
 * - `destructive` deletes data or cannot be undone; a host should confirm first.
 */
export type ToolKind = "read" | "write" | "destructive";

export interface ToolDefinition<
  Schema extends z.ZodObject = z.ZodObject,
  Result = unknown,
> {
  /** Dotted, resource-first identifier: `registries.delete`. Unique across the catalog. */
  name: string;
  /** Human label for pickers and tool listings. Defaults to the name. */
  title?: string;
  /** What the tool does, written for someone (or something) choosing between tools. */
  description: string;
  /** Input contract. Object schemas only, so every surface can render it as flags or JSON Schema. */
  schema: Schema;
  /** Effect on remote state. Drives confirmations and tool annotations. */
  kind: ToolKind;
  /** Shape of the data `run` resolves with. Declarative: published as the output schema, not re-validated. */
  resultSchema?: z.ZodType<Result>;
  /** True when the result contains credentials, so a host can mask or withhold it. */
  sensitive?: boolean;
  /** True when path inputs refer to the host's local filesystem; a remote host should exclude these. */
  localFiles?: boolean;
  /** Extra detail for `--help` and tool descriptions. Each entry is `[input, description]`. */
  examples?: ReadonlyArray<readonly [z.input<Schema>, string]>;
  /** Does the work and returns plain serializable data. Never prints, never prompts. */
  run(ctx: ToolContext, input: z.infer<Schema>): Promise<Result>;
}

export interface Tool<
  Schema extends z.ZodObject = z.ZodObject,
  Result = unknown,
> extends ToolDefinition<Schema, Result> {
  /** Validate raw input against `schema`, then run. */
  invoke(ctx: ToolContext, input: unknown): Promise<Result>;
}

// A Zod failure becomes the UserError every surface already knows how to render.
function inputError(name: string, error: z.ZodError): UserError {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
  return new UserError(`Invalid input for "${name}": ${details}.`);
}

/**
 * Define a single unit of bunny.net work, independent of how it is invoked.
 *
 * One definition backs every surface: the CLI wraps it in a yargs command, a
 * tool server exposes it over the wire, and an agent imports it directly.
 *
 * @example
 * ```ts
 * export const registriesGet = defineTool({
 *   name: "registries.get",
 *   description: "Get one container registry by ID.",
 *   schema: z.strictObject({ registry: z.number().describe("Registry ID") }),
 *   kind: "read",
 *   run: async (ctx, { registry }) => toRegistry(await fetchRegistry(ctx.clients.mc, registry)),
 * });
 * ```
 */
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
