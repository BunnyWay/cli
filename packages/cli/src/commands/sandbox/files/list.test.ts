import { describe, expect, test } from "bun:test";
import { parseLsTarget } from "./list.ts";

describe("parseLsTarget", () => {
  test("a bare sandbox name lists the workplace", () => {
    expect(parseLsTarget("my-sandbox")).toEqual({
      sandbox: "my-sandbox",
      path: ".",
    });
  });

  test("a sandbox:path reference lists that path", () => {
    expect(parseLsTarget("my-sandbox:/workplace/src")).toEqual({
      sandbox: "my-sandbox",
      path: "/workplace/src",
    });
    expect(parseLsTarget("my-sandbox:src")).toEqual({
      sandbox: "my-sandbox",
      path: "src",
    });
  });
});
