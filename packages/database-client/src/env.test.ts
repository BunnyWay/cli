import { describe, expect, test } from "bun:test";
import { readEnv } from "./env.ts";

const NAME = "BUNNY_READENV_TEST";

describe("readEnv", () => {
  test("reads from process.env", () => {
    process.env[NAME] = "from-process";
    try {
      expect(readEnv(NAME)).toBe("from-process");
    } finally {
      delete process.env[NAME];
    }
  });

  test("missing and empty string both read as unset", () => {
    delete process.env[NAME];
    expect(readEnv(NAME)).toBeUndefined();
    process.env[NAME] = "";
    try {
      expect(readEnv(NAME)).toBeUndefined();
    } finally {
      delete process.env[NAME];
    }
  });

  test("a permission throw reads as unset, not a crash", () => {
    const g = globalThis as { process?: unknown };
    const realProcess = g.process;
    g.process = {
      env: new Proxy(
        {},
        {
          get() {
            throw new Error("NotCapable: Requires env access");
          },
        },
      ),
    };
    try {
      expect(readEnv(NAME)).toBeUndefined();
    } finally {
      g.process = realProcess;
    }
  });
});
