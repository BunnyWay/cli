import { afterEach, beforeEach, expect, test } from "bun:test";
import { resolveConfig } from "./index.ts";

const saved = process.env.BUNNYNET_API_KEY;

function setKey(value?: string): void {
  if (value === undefined) delete process.env.BUNNYNET_API_KEY;
  else process.env.BUNNYNET_API_KEY = value;
}

beforeEach(() => setKey(undefined));
afterEach(() => setKey(saved));

test("BUNNYNET_API_KEY authenticates without a stored profile", () => {
  setKey("env-key");
  const config = resolveConfig("default");
  expect(config.apiKey).toBe("env-key");
  expect(config.profile).toBe("");
});

test("--api-key wins over BUNNYNET_API_KEY", () => {
  setKey("env-key");
  expect(resolveConfig("default", "flag-key").apiKey).toBe("flag-key");
});

test("an empty BUNNYNET_API_KEY is not treated as a credential", () => {
  setKey("");
  expect(resolveConfig("default", "flag-key").apiKey).toBe("flag-key");
});
