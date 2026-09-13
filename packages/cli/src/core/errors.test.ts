import { afterEach, expect, test } from "bun:test";
import { unauthorizedError } from "./errors.ts";

const originalEnvKey = process.env.BUNNYNET_API_KEY;
afterEach(() => {
  if (originalEnvKey === undefined) delete process.env.BUNNYNET_API_KEY;
  else process.env.BUNNYNET_API_KEY = originalEnvKey;
});

test("a 401 with no credential loaded says so instead of blaming the default profile", () => {
  delete process.env.BUNNYNET_API_KEY;
  const none = unauthorizedError({ profile: "default", hasProfile: false });
  expect(none.message).toBe("Not logged in.");
  expect(none.hint).toBe('Run "bunny login" to authenticate.');
  const stored = unauthorizedError({ profile: "$prod", hasProfile: true });
  expect(stored.hint).toContain("profile '$prod'");
  expect(stored.hint).toContain("bunny login --profile '$prod'");
});
