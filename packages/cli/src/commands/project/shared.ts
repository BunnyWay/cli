import {
  BindingNameSchema,
  type BunnyProjectConfig,
  type ResourceKind,
} from "@bunny.net/project-config";
import { UserError } from "../../core/errors.ts";
import { confirm } from "../../core/ui.ts";

export const ARG_BINDING = "binding";
export const ARG_BINDING_DESCRIPTION =
  "Binding name to map the resource under (e.g. db, api)";

/** Reject binding names the schema would refuse before any API call is made. */
export function assertBindingName(binding: string): void {
  const result = BindingNameSchema.safeParse(binding);
  if (!result.success) {
    throw new UserError(
      `"${binding}" is not a valid binding name.`,
      "Binding names must start with a letter and contain only letters, digits, '_' or '-'.",
    );
  }
}

/** Confirm before repointing an existing binding to a different resource; throws when non-interactive. */
export async function ensureBindingReplaceable(
  config: BunnyProjectConfig,
  kind: ResourceKind,
  binding: string,
  newId: string | number,
  interactive: boolean,
): Promise<void> {
  const existing = config[kind]?.[binding];
  if (!existing || existing.id === newId) return;

  const label = existing.name ?? existing.id;
  if (!interactive) {
    throw new UserError(
      `Binding "${binding}" already maps to ${label}.`,
      "Pick a different binding name, or run interactively to replace it.",
    );
  }

  const replace = await confirm(
    `Binding "${binding}" already maps to ${label} — replace it?`,
    { force: false },
  );
  if (!replace) throw new UserError("Cancelled.");
}
