import { expect, test } from "bun:test";
import { findPreset } from "./presets.ts";
import { renderSitesWorkflow } from "./workflow.ts";

test("pushes to main deploy unless the repository's branch differs", () => {
  const preset = findPreset("static")!;
  expect(
    renderSitesWorkflow({ site: "s", preset, packageManager: "npm" }),
  ).toContain("    branches: [main]");
  expect(
    renderSitesWorkflow({
      site: "s",
      preset,
      packageManager: "npm",
      branch: "master",
    }),
  ).toContain("    branches: [master]");
});
