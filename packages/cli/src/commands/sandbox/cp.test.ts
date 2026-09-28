import { describe, expect, test } from "bun:test";
import { rewriteCpCommand, sandboxCpMovedCommand } from "./cp.ts";

describe("the moved sandbox cp stub", () => {
  test("stays out of help", () => {
    expect(sandboxCpMovedCommand.describe).toBe(false);
  });

  test("replays plain args against the new path", () => {
    expect(rewriteCpCommand(["./app.js", "my-sandbox:app.js"])).toBe(
      "bunny sandbox files cp ./app.js my-sandbox:app.js",
    );
    expect(rewriteCpCommand([])).toBe("bunny sandbox files cp");
  });

  test("quotes args the shell would otherwise re-split or interpret", () => {
    expect(rewriteCpCommand(["my app.js", "box:my app.js"])).toBe(
      "bunny sandbox files cp 'my app.js' 'box:my app.js'",
    );
    expect(rewriteCpCommand(["a;rm -rf b", ""])).toBe(
      "bunny sandbox files cp 'a;rm -rf b' ''",
    );
    expect(rewriteCpCommand(["it's.js", "box:x"])).toBe(
      "bunny sandbox files cp 'it'\\''s.js' box:x",
    );
  });
});
