import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { UserError } from "@bunny.net/openapi-client";
import type { ToolEnv } from "../../context.ts";

/** No single saved import matched; carries what a host needs to word its own next step. */
export class SavedImportError extends UserError {
  constructor(
    message: string,
    hint: string,
    readonly libraryId: number,
    /** The sources with a saved import for this library: none, or several to choose from. */
    readonly sources: string[],
    readonly source?: string,
  ) {
    super(message, hint);
  }
}

/** Neither XDG_STATE_HOME nor HOME is set, so there is nowhere to journal; a host rewords the hint for its own env. */
export class StateHomeError extends UserError {}

/** The XDG state directory from the host env; tools never read the live process environment. */
function stateHome(env: ToolEnv): string {
  if (env.XDG_STATE_HOME) return env.XDG_STATE_HOME;
  if (env.HOME) return join(env.HOME, ".local", "state");
  throw new StateHomeError(
    "No directory for the import journal.",
    "Set XDG_STATE_HOME or HOME in the tool context's env.",
  );
}

/** Saved import progress under the XDG state directory: one file per account, source, and library, since library IDs repeat across accounts. */
export function importStatePath(
  source: string,
  libraryId: number,
  accountId: string,
  env: ToolEnv,
): string {
  return join(
    stateHome(env),
    "bunnynet",
    "stream-import",
    accountId,
    `${source}-${libraryId}.json`,
  );
}

/** The one source with a saved import for this library, when no source was named. */
export function findSavedImportSource(
  libraryId: number,
  accountId: string,
  env: ToolEnv,
): string {
  const dir = dirname(importStatePath("x", libraryId, accountId, env));
  const suffix = `-${libraryId}.json`;
  const sources = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(suffix))
        .map((f) => f.slice(0, -suffix.length))
    : [];

  if (sources.length === 1 && sources[0]) return sources[0];
  throw new SavedImportError(
    sources.length === 0
      ? `No saved import for library ${libraryId}.`
      : `Library ${libraryId} has imports from ${sources.join(", ")}.`,
    sources.length === 0
      ? "Run an import for this library first."
      : "Set `source` to pick one.",
    libraryId,
    sources,
  );
}
