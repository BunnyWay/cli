import { describe, expect, test } from "bun:test";
import { targetSuffix } from "./commands.ts";

describe("targetSuffix", () => {
  test("preserves the storage zone positional", () => {
    // bunny storage zone domains add cdn.example.com my-zone
    expect(targetSuffix({ zone: "my-zone" }, "zone")).toBe(" my-zone");
  });

  test("preserves the script id positional without duplicating it as a flag", () => {
    expect(targetSuffix({ id: 123 }, "id")).toBe(" 123");
  });

  test("appends --pull-zone after the positional", () => {
    expect(targetSuffix({ zone: "my-zone", "pull-zone": 678 }, "zone")).toBe(
      " my-zone --pull-zone 678",
    );
  });

  test("emits nothing when the positional was omitted (resolved from manifest)", () => {
    expect(targetSuffix({}, "id")).toBe("");
  });

  test("emits --pull-zone alone when no positional name is given", () => {
    expect(targetSuffix({ "pull-zone": 678 })).toBe(" --pull-zone 678");
  });
});
