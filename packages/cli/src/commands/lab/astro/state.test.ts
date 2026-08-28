import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../../test-utils/temp-dir.ts";
import {
  clearState,
  type LabState,
  loadState,
  markCurrent,
  STATE_VERSION,
  saveState,
  statePath,
} from "./state.ts";

const tempDir = useTempDir("bunny-lab-state-");

function state(overrides?: Partial<LabState>): LabState {
  return {
    version: STATE_VERSION,
    name: "my-app",
    storageZone: "astro-my-app-a1b2c3",
    storageZoneId: 1,
    region: "de",
    scriptId: 2,
    pullZoneId: 3,
    ...overrides,
  };
}

test("state is written and read back from the project", () => {
  const root = tempDir();
  saveState(root, state({ current: "aaaa1111" }));
  expect(loadState(root)?.current).toBe("aaaa1111");
  expect(statePath(root)).toBe(join(root, ".bunny", "astro.json"));
});

// Walking up from the working directory was the bug: `bunny lab deploy astro
// ./project` run from anywhere else found no state, called the app new, and
// created a second set of resources beside the first.
test("state belongs to the project, not to a directory above it", () => {
  const above = tempDir();
  const project = join(above, "project");
  mkdirSync(project, { recursive: true });
  saveState(project, state());

  // The state is the project's. A command run in the parent finds none, which is
  // what makes the parent a different app rather than the same one.
  expect(loadState(project)?.name).toBe("my-app");
  expect(loadState(above)).toBeNull();
});

test("a project with no state reads as null", () => {
  expect(loadState(tempDir())).toBeNull();
});

// The file is a pointer. A deploy that re-finds its resources by name recovers
// from a damaged one, so it must not be an error.
test("state that does not parse reads as absent", () => {
  const root = tempDir();
  mkdirSync(join(root, ".bunny"), { recursive: true });
  writeFileSync(join(root, ".bunny", "astro.json"), "{ not json");
  expect(loadState(root)).toBeNull();

  writeFileSync(join(root, ".bunny", "astro.json"), '{"version":1}');
  expect(loadState(root)).toBeNull();
});

test("clearing the state removes the file", () => {
  const root = tempDir();
  saveState(root, state());
  clearState(root);
  expect(loadState(root)).toBeNull();
  // Clearing what is not there is not an error.
  clearState(root);
});

test("the outgoing deploy becomes the previous one", () => {
  const s = state({ current: "aaaa1111" });
  markCurrent(s, "bbbb2222");
  expect(s.current).toBe("bbbb2222");
  expect(s.previous).toBe("aaaa1111");

  // Re-publishing the same deploy does not make it its own predecessor.
  markCurrent(s, "bbbb2222");
  expect(s.previous).toBe("aaaa1111");
});
