/**
 * The link between a project directory and what it deploys to.
 *
 * `bunny sites` keeps its state in the storage zone, because a site outlives
 * every clone of the repository. This command keeps it locally instead, at
 * `.bunny/astro.json`, for one reason: an undeploy has to name what it is about
 * to delete, before it asks.
 *
 * Losing the file is not fatal. `--name` finds the same resources by name, which
 * is what a fresh clone and a CI runner both do.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** The file, under the project's `.bunny/`. That directory is git-ignored. */
export const STATE_FILE = "astro.json";

export const STATE_VERSION = 1;

export const LabStateSchema = z.object({
  version: z.number().int().positive(),
  /** The app name the developer chose. Every resource name derives from it. */
  name: z.string(),
  /** The storage zone's own name, which carries the random suffix. */
  storageZone: z.string(),
  storageZoneId: z.number().int().positive(),
  /** The zone's region code, lowercase, for the endpoint the script reads. */
  region: z.string(),
  scriptId: z.number().int().positive(),
  pullZoneId: z.number().int().positive(),
  /** The `*.b-cdn.net` host, for the line the deploy prints. */
  hostname: z.string().optional(),
  /** The deploy now published. Its files are the ones the script reads. */
  current: z.string().optional(),
  /** The deploy before it. Kept so its files survive one more deploy. */
  previous: z.string().optional(),
  /** The current deploy's content hash, so an unchanged one can be skipped. */
  contentHash: z.string().optional(),
});

export type LabState = z.infer<typeof LabStateSchema>;

/**
 * Where the state lives, for one project.
 *
 * The path is always built from the project root, never from the working
 * directory. Walking up from the current directory is what `bunny scripts` does,
 * and here it was wrong: `bunny lab deploy astro ./some/project` run from
 * anywhere else found no state, decided the app was new, and created a second set
 * of resources beside the first.
 */
export function statePath(root: string): string {
  return join(root, ".bunny", STATE_FILE);
}

/**
 * The state for this project, or null when there is none to read.
 *
 * A file this cannot parse is treated as absent, not as an error. It is a
 * pointer, and a deploy that re-finds its resources by name recovers from a bad
 * one without asking anybody to delete a file by hand.
 */
export function loadState(root: string): LabState | null {
  const path = statePath(root);
  if (!existsSync(path)) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const parsed = LabStateSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function saveState(root: string, state: LabState): void {
  const path = statePath(root);
  mkdirSync(join(root, ".bunny"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export function clearState(root: string): void {
  const path = statePath(root);
  if (existsSync(path)) rmSync(path);
}

/** Point the state at `deployId`, remembering the outgoing deploy. */
export function markCurrent(state: LabState, deployId: string): void {
  if (state.current && state.current !== deployId) {
    state.previous = state.current;
  }
  state.current = deployId;
}
