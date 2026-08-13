import { expect, test } from "bun:test";
import { requireConfirmable } from "./ui.ts";

const OPTS = { message: "Needs a prompt.", hint: "Re-run with --force." };

// `bun test` runs without a TTY, so every call here takes the unattended path.
test("requireConfirmable throws when there's no TTY to answer the prompt", () => {
  expect(() => requireConfirmable("text", OPTS)).toThrow("Needs a prompt.");
  expect(() => requireConfirmable("json", OPTS)).toThrow("Needs a prompt.");
});

test("requireConfirmable passes with --force", () => {
  expect(() =>
    requireConfirmable("json", { ...OPTS, force: true }),
  ).not.toThrow();
});
