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
  ).toContain('    branches: ["master"]');
});

test("a branch with YAML flow syntax stays one branch", () => {
  const yml = renderSitesWorkflow({
    site: "s",
    preset: findPreset("static")!,
    packageManager: "npm",
    branch: "release,prod]",
  });
  // Older Bun parses YAML 1.1, where the `on` key reads as the boolean true.
  const workflow = Bun.YAML.parse(yml) as Record<
    string,
    { push?: { branches: string[] } }
  >;
  const on = workflow.on ?? workflow.true;
  expect(on?.push?.branches).toEqual(["release,prod]"]);
});
