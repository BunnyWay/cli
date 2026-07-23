import { UserError } from "@bunny.net/openapi-client";
import type { z } from "zod";
import type { ActionContext } from "./context.ts";

/** Dotted lowercase path, e.g. `storage.zones.list`. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

/**
 * What an action does to remote state, from the host's point of view.
 *
 * - `read` touches nothing; safe to run unattended.
 * - `write` creates or updates remote state; invoking it is normally intent enough.
 * - `destructive` deletes data or cannot be undone; a host should confirm first.
 */
export type ActionKind = "read" | "write" | "destructive";

export interface ActionDefinition<
  Schema extends z.ZodObject = z.ZodObject,
  Result = unknown,
> {
  /** Dotted, resource-first identifier: `storage.zones.delete`. Unique across the registry. */
  name: string;
  /** Human label for pickers and tool listings. Defaults to the name. */
  title?: string;
  /** What the action does, written for someone (or something) choosing between actions. */
  description: string;
  /** Input contract. Object schemas only, so every surface can render it as flags or JSON Schema. */
  schema: Schema;
  /** Effect on remote state. Drives confirmations and tool annotations. */
  kind: ActionKind;
  /**
   * Shape of the data {@link ActionDefinition.run} resolves with. Declarative:
   * results are not re-validated at runtime, but a host can publish it as the
   * action's output schema or render it as documentation.
   */
  resultSchema?: z.ZodType<Result>;
  /**
   * True when the result contains credentials. Read-only, but a host may still
   * want to withhold it from an agent or redact it from a transcript.
   */
  sensitive?: boolean;
  /**
   * True when the action reads or writes the local filesystem, so path inputs
   * are host-local. A host running somewhere else should exclude these via
   * `listActions({ localFiles: false })`.
   */
  localFiles?: boolean;
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
 * One definition backs every surface: the CLI wraps it in a yargs command, a
 * tool server exposes it over the wire, and an agent imports it directly.
 *
 * @example
 * ```ts
 * export const storageZonesGet = defineAction({
 *   name: "storage.zones.get",
 *   description: "Get a single storage zone by name or ID.",
 *   schema: z.strictObject({ zone: z.string().describe("Zone name or numeric ID") }),
 *   kind: "read",
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
