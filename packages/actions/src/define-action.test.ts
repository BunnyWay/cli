import { expect, test } from "bun:test";
import { z } from "zod";
import { createActionContext } from "./context.ts";
import { defineAction } from "./define-action.ts";

const echo = defineAction({
  name: "test.echo",
  description: "Echo the input back, for tests.",
  schema: z.strictObject({ value: z.string().min(1) }),
  kind: "read",
  run: async (_ctx, input) => input.value,
});

test("invoke validates input before running", async () => {
  const ctx = createActionContext();
  expect(await echo.invoke(ctx, { value: "hi" })).toBe("hi");

  await expect(echo.invoke(ctx, { value: 42 })).rejects.toThrow(
    /Invalid input for "test.echo": value/,
  );
  await expect(echo.invoke(ctx, { other: "x" })).rejects.toThrow(
    /Invalid input for "test.echo"/,
  );
});

test("invoke defaults missing input to an empty object", async () => {
  const noArgs = defineAction({
    name: "test.noargs",
    description: "Takes no input at all.",
    schema: z.strictObject({}),
    kind: "read",
    run: async () => "ok",
  });
  expect(await noArgs.invoke(createActionContext(), undefined)).toBe("ok");
});

test("action names must be dotted and lowercase", () => {
  expect(() =>
    defineAction({
      name: "storageZonesList",
      description: "Bad name.",
      schema: z.strictObject({}),
      kind: "read",
      run: async () => null,
    }),
  ).toThrow(/Invalid action name/);
});

test("a context without an API key fails only when a client is used", () => {
  const ctx = createActionContext();
  expect(() => ctx.clients.core).toThrow(/No bunny.net API key/);
});

test("progress and debug are no-ops unless the host listens", async () => {
  const messages: string[] = [];
  const ctx = createActionContext({ onProgress: (m) => messages.push(m) });
  ctx.progress("working");
  ctx.debug("ignored");
  expect(messages).toEqual(["working"]);
});
