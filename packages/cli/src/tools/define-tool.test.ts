import { expect, test } from "bun:test";
import { z } from "zod";
import { createToolContext } from "./context.ts";
import { defineTool } from "./define-tool.ts";

const echo = defineTool({
  name: "test.echo",
  description: "Echo the input back, for tests.",
  schema: z.strictObject({ value: z.string().min(1) }),
  kind: "read",
  run: async (_ctx, input) => input.value,
});

test("invoke validates input before running and defaults missing input to {}", async () => {
  const ctx = createToolContext();
  expect(await echo.invoke(ctx, { value: "hi" })).toBe("hi");
  await expect(echo.invoke(ctx, { value: 42 })).rejects.toThrow(
    /Invalid input for "test.echo": value/,
  );
  await expect(echo.invoke(ctx, { other: "x" })).rejects.toThrow(
    /Invalid input for "test.echo"/,
  );

  const noArgs = defineTool({
    name: "test.noargs",
    description: "Takes no input at all.",
    schema: z.strictObject({}),
    kind: "read",
    run: async () => "ok",
  });
  expect(await noArgs.invoke(ctx, undefined)).toBe("ok");
});

test("tool names must be dotted and lowercase", () => {
  expect(() =>
    defineTool({
      name: "registriesList",
      description: "Bad name.",
      schema: z.strictObject({}),
      kind: "read",
      run: async () => null,
    }),
  ).toThrow(/Invalid tool name/);
});

test("a context without an API key fails only when a client is used", () => {
  const messages: string[] = [];
  const ctx = createToolContext({ onProgress: (m) => messages.push(m) });
  ctx.progress("working");
  ctx.debug("ignored");
  expect(messages).toEqual(["working"]);
  expect(() => ctx.clients.mc).toThrow(/No bunny.net API key/);
});
