import { UserError } from "@bunny.net/openapi-client";
import type { z } from "zod";
import type { ActionContext } from "./context.ts";

/** Dotted lowercase path, e.g. `storage.zones.list`. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

export interface ActionDefinition<
  Schema extends z.ZodObject = z.ZodObject,
  Result = unknown,
> {
  /** Dotted, resource-first identifier: `storage.zones.delete`. Unique across the registry. */
  name: string;
  /** Human label for pickers and MCP clients. Defaults to the name. */
  title?: string;
  /** What the action does, written for someone (or something) choosing between actions. */
  description: string;
  /** Input contract. Object schemas only, so every surface can render it as flags or JSON Schema. */
  schema: Schema;
  /** True when the action creates, mutates, or deletes remote state. Drives confirmations and tool annotations. */
  destructive: boolean;
  /**
   * True when the result contains credentials. Read-only, but a host may still
   * want to withhold it from an agent or redact it from a transcript.
   */
  sensitive?: boolean;
  /** Extra detail for `--help` and tool descriptions. Each entry is `[input, description]`. */
  examples?: ReadonlyArray<readonly [z.input<Schema>, string]>;
  /** Does the work and returns plain serializable data. Never prints, never prompts. */
  run(ctx: ActionContext, input: z.infer<Schema>): Promise<Result>;
}

export interface Action<
  Schema extends z.ZodObject = z.ZodObject,
  Result = unknown,
> extends ActionDefinition<Schema, Result> {
  /** Validate raw input against {@link ActionDefinition.schema}, then run. */
  invoke(ctx: ActionContext, input: unknown): Promise<Result>;
}

/** Turn a Zod failure into a {@link UserError} every surface already knows how to render. */
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
 * One definition backs three surfaces: the CLI wraps it in a yargs command,
 * an MCP server exposes it as a tool, and an agent imports it directly.
 *
 * @example
 * ```ts
 * export const storageZonesGet = defineAction({
 *   name: "storage.zones.get",
 *   description: "Get a single storage zone by name or ID.",
 *   schema: z.strictObject({ zone: z.string().describe("Zone name or numeric ID") }),
 *   destructive: false,
 *   run: async (ctx, { zone }) => toStorageZone(await resolveStorageZone(ctx.clients.core, zone)),
 * });
 * ```
 */
export function defineAction<Schema extends z.ZodObject, Result>(
  def: ActionDefinition<Schema, Result>,
): Action<Schema, Result> {
  if (!NAME_PATTERN.test(def.name)) {
    throw new Error(
      `Invalid action name "${def.name}". Use a dotted lowercase path like "storage.zones.list".`,
    );
  }
  if (!def.description.trim()) {
    throw new Error(`Action "${def.name}" is missing a description.`);
  }

  return {
    ...def,
    // Async so a validation failure rejects like any other action error.
    async invoke(ctx, input) {
      const parsed = def.schema.safeParse(input ?? {});
      if (!parsed.success) throw inputError(def.name, parsed.error);
      return def.run(ctx, parsed.data as z.infer<Schema>);
    },
  };
}
