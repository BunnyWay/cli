import { expect, test } from "bun:test";
import { detectFrameworkFrom, detectPackageManagerFrom } from "./detect.ts";

test("a meta-framework wins over the vite it depends on", () => {
  const preset = detectFrameworkFrom({
    entries: ["package.json", "astro.config.mjs"],
    packageJson: { devDependencies: { vite: "^6", astro: "^5" } },
  });
  expect(preset?.id).toBe("astro");
});

test("non-JS frameworks are found by their files alone", () => {
  expect(detectFrameworkFrom({ entries: ["mkdocs.yml", "docs"] })?.id).toBe(
    "mkdocs",
  );
  expect(
    detectFrameworkFrom({ entries: ["config.toml", "templates"] })?.id,
  ).toBe("zola");
  expect(detectFrameworkFrom({ entries: ["config.toml", "content"] })?.id).toBe(
    "hugo",
  );
  expect(
    detectFrameworkFrom({ entries: ["Gemfile"], gemfile: 'gem "jekyll"' })?.id,
  ).toBe("jekyll");
  expect(detectFrameworkFrom({ entries: ["index.html"] })).toBeUndefined();
});

test("the lockfile names the package manager", () => {
  expect(detectPackageManagerFrom(["bun.lock"])).toBe("bun");
  expect(detectPackageManagerFrom(["pnpm-lock.yaml"])).toBe("pnpm");
  expect(detectPackageManagerFrom(["package.json"])).toBe("npm");
});
