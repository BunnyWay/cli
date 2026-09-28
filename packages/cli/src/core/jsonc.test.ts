import { describe, expect, test } from "bun:test";
import { parse as parseJsonc } from "jsonc-parser";
import { syncJsonc } from "./jsonc.ts";

describe("syncJsonc", () => {
  test("preserves comments on untouched keys", () => {
    const text = `{
  // the app to deploy
  "version": "2026-05-11",
  "app": {
    "name": "demo" // display name
  }
}`;
    const out = syncJsonc(text, {
      version: "2026-05-11",
      app: { name: "demo" },
    });
    expect(out).toContain("// the app to deploy");
    expect(out).toContain("// display name");
  });

  test("updates only the changed leaf, keeping surrounding comments", () => {
    const text = `{
  // keep me
  "version": "2026-05-11",
  "app": { "name": "old" }
}`;
    const out = syncJsonc(text, {
      version: "2026-05-11",
      app: { name: "new" },
    });
    expect(out).toContain("// keep me");
    expect(parseJsonc(out).app.name).toBe("new");
  });

  test("appends new keys and removes absent ones", () => {
    const text = `{ "version": "2026-05-11", "app": { "name": "x", "id": "app_1" } }`;
    const out = syncJsonc(text, {
      version: "2026-05-11",
      app: { name: "x" },
      sites: { dir: "dist" },
    });
    const parsed = parseJsonc(out);
    expect(parsed.app.id).toBeUndefined();
    expect(parsed.sites).toEqual({ dir: "dist" });
  });

  test("leaves an already-matching object byte-identical", () => {
    const text = `{
  "version": "2026-05-11",
  "app": { "name": "x" }
}`;
    const out = syncJsonc(text, {
      version: "2026-05-11",
      app: { name: "x" },
    });
    expect(out).toBe(`${text}\n`);
  });

  test("serializes fresh when the input is not a JSON object", () => {
    const out = syncJsonc("", { version: "2026-05-11" });
    expect(parseJsonc(out)).toEqual({ version: "2026-05-11" });
  });
});
