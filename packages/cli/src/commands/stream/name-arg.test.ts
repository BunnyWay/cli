import { expect, test } from "bun:test";
import { nameArg } from "./name-arg.ts";

test("the positional and --name must agree once trimmed", () => {
  expect(nameArg("Tutorials", " Tutorials ")).toBe("Tutorials");
  expect(() => nameArg("one", "two")).toThrow(/Conflicting names/);
});
