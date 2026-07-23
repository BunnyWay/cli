import { UserError } from "@bunny.net/openapi-client";
import { dbActions } from "./actions/db/index.ts";
import { storageActions } from "./actions/storage/index.ts";
import type { ActionContext } from "./context.ts";
import type { Action } from "./define-action.ts";

function index(all: Action[]): Map<string, Action> {
  const map = new Map<string, Action>();
  for (const action of all) {
    if (map.has(action.name)) {
      throw new Error(`Duplicate action name: ${action.name}`);
    }
    map.set(action.name, action);
  }
  return map;
}

/** Every action, sorted by name. This is the curated surface an agent gets. */
export const actions: readonly Action[] = Object.freeze(
  [...storageActions, ...dbActions].sort((a, b) =>
    a.name.localeCompare(b.name),
  ),
);

const byName = index([...actions]);

export function getAction(name: string): Action | undefined {
  return byName.get(name);
}

export function requireAction(name: string): Action {
  const action = getAction(name);
  if (!action) {
    throw new UserError(
      `Unknown action "${name}".`,
      `Known actions: ${[...byName.keys()].join(", ")}.`,
    );
  }
  return action;
}

export interface ActionFilter {
  /** Restrict to (non-)destructive actions. Omit for both. */
  destructive?: boolean;
  /** Dotted prefix, e.g. `storage` or `storage.zones`. */
  namespace?: string;
}

export function listActions(filter: ActionFilter = {}): Action[] {
  return actions.filter((action) => {
    if (
      filter.destructive !== undefined &&
      action.destructive !== filter.destructive
    ) {
      return false;
    }
    if (filter.namespace && !action.name.startsWith(`${filter.namespace}.`)) {
      return false;
    }
    return true;
  });
}

/** Look an action up by name, validate the input, and run it. */
export function runAction(
  name: string,
  ctx: ActionContext,
  input: unknown,
): Promise<unknown> {
  return requireAction(name).invoke(ctx, input);
}
