import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "@/test-utils/temp-dir.ts";
import { BUNNY_REGISTRY_ID, type McClient } from "./docker.ts";
import { runWalkthrough, type WalkthroughInput } from "./walkthrough.ts";

// Only the regions lookup reaches the API on the build path.
const client = {
  GET: async () => ({
    data: { items: [{ id: "de", name: "Frankfurt", hasCapacity: true }] },
  }),
} as unknown as McClient;

const originalCwd = process.cwd();
afterEach(() => process.chdir(originalCwd));

describe("runWalkthrough without a terminal (agents)", () => {
  const dir = useTempDir();

  function inProject(files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      writeFileSync(join(dir(), path), text);
    }
    process.chdir(dir());
  }

  const agent = (input: Partial<WalkthroughInput> = {}) =>
    runWalkthrough(client, {
      interactive: false,
      buildsImage: false,
      dryRun: true,
      ...input,
    });

  test("--dockerfile generates one and takes every default", async () => {
    inProject({ "index.php": "<?php echo 'hi';" });
    const { config, registries } = await agent({
      dockerfileFlag: "Dockerfile",
      regionFlag: "de",
    });

    const name = Object.keys(config.app.containers)[0] ?? "";
    expect(config.app.regions).toEqual(["de"]);
    expect(registries[name]).toBe(BUNNY_REGISTRY_ID);
    expect(config.app.containers[name]).toMatchObject({
      dockerfile: "Dockerfile",
      endpoints: [{ type: "cdn", ports: [{ public: 443, container: 8080 }] }],
    });
  });

  test("a missing region names the flag and the choices", async () => {
    inProject({ "index.php": "" });
    await expect(agent({ dockerfileFlag: "Dockerfile" })).rejects.toMatchObject(
      {
        message: "A region is required.",
        hint: "Pass --region with one of: de.",
      },
    );
  });

  test("nothing chosen to deploy names the flags instead of prompting", async () => {
    inProject({ "index.php": "" });
    await expect(agent({ regionFlag: "de" })).rejects.toThrow(
      /Nothing to deploy/,
    );
  });
});
