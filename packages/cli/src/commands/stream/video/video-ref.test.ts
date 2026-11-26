import { expect, test } from "bun:test";
import type { ToolContext } from "@/tools/index.ts";
import { resolveVideoRef } from "./video-ref.ts";

// Neither path reaches the API, so a bare context is enough.
const ctx = {} as ToolContext;

test("an explicit GUID passes straight through", async () => {
  expect(await resolveVideoRef(ctx, 4321, "abc")).toBe("abc");
});

test("without a GUID it never prompts unattended", async () => {
  await expect(
    resolveVideoRef(ctx, 4321, undefined, { output: "json" }),
  ).rejects.toThrow("A video is required.");
  await expect(
    resolveVideoRef(ctx, 4321, undefined, { force: true }),
  ).rejects.toThrow("A video is required.");
});
