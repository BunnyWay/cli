import { expect, test } from "bun:test";
import {
  appNameFrom,
  deployPrefix,
  isValidAppName,
  requireValidAppName,
  resourcePattern,
  scriptName,
  suffixedName,
} from "./naming.ts";

test("a name from a scoped package drops the scope", () => {
  expect(appNameFrom("@example/ssr")).toBe("ssr");
  expect(appNameFrom("@acme/My_Blog")).toBe("my-blog");
});

test("a name a DNS label cannot hold is refused", () => {
  expect(appNameFrom("!!")).toBeNull();
  expect(isValidAppName("-blog")).toBe(false);
  expect(isValidAppName("blog-")).toBe(false);
  expect(isValidAppName("ab")).toBe(false);
  expect(isValidAppName("my-blog")).toBe(true);
});

test("an unusable name stops the command with the rules", () => {
  expect(() => requireValidAppName("no")).toThrow(/not a usable app name/);
});

// `astro-ssr-demo` became `astro-astro-ssr-demo-a1b2c3`, which reads like a
// mistake and spends six characters of a 63-character DNS label on nothing.
test("the prefix is not added twice", () => {
  const name = suffixedName("astro-ssr-demo");
  expect(name).toMatch(/^astro-ssr-demo-[a-z0-9]{6}$/);
  expect(resourcePattern("astro-ssr-demo").test(name)).toBe(true);
});

test("a name without the prefix gets one", () => {
  const name = suffixedName("blog");
  expect(name).toMatch(/^astro-blog-[a-z0-9]{6}$/);
  expect(resourcePattern("blog").test(name)).toBe(true);
});

// The pattern is how a deploy finds the zone it made last time. A name that only
// starts the same must not match, or one app adopts another's resources.
test("the pattern matches this app's zones and no others", () => {
  const pattern = resourcePattern("blog");
  expect(pattern.test("astro-blog-a1b2c3")).toBe(true);
  expect(pattern.test("astro-blog-sessions")).toBe(false);
  expect(pattern.test("astro-blogging-a1b2c3")).toBe(false);
  expect(pattern.test("sites-blog-a1b2c3")).toBe(false);
});

test("the script takes the zone's own name", () => {
  expect(scriptName("astro-blog-a1b2c3")).toBe("astro-blog-a1b2c3-server");
});

test("a deploy's files live under its own id", () => {
  expect(deployPrefix("a1b2c3d4")).toBe("deploys/a1b2c3d4");
});
