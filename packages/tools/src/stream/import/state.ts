import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { UserError } from "@bunny.net/openapi-client";
import type { ToolEnv } from "../../context.ts";

/** Saved import progress under the XDG state directory: one file per account, source, and library, since library IDs repeat across accounts. */
export function importStatePath(
  source: string,
  libraryId: number,
  accountId: string,
  env: ToolEnv = process.env,
): string {
  const base = env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");

  return join(
    base,
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
  env: ToolEnv = process.env,
): string {
  const dir = dirname(importStatePath("x", libraryId, accountId, env));
  const suffix = `-${libraryId}.json`;
  const sources = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(suffix))
        .map((f) => f.slice(0, -suffix.length))
    : [];

  if (sources.length === 1 && sources[0]) return sources[0];
  throw new UserError(
    sources.length === 0
      ? `No saved import for library ${libraryId}.`
      : `Library ${libraryId} has imports from ${sources.join(", ")}.`,
    sources.length === 0
      ? "Start one with `bunny stream import`."
      : "Pass --source to pick one.",
  );
}
