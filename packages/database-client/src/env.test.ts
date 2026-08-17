import { describe, expect, test } from "bun:test";
import { readEnv } from "./env.ts";

const NAME = "BUNNY_READENV_TEST";

type GlobalWithSniffs = {
  Deno?: { env?: { get(key: string): string | undefined } };
  process?: unknown;
};
const g = globalThis as GlobalWithSniffs;

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

  test("prefers Deno.env.get when a Deno global is present", () => {
    process.env[NAME] = "from-process";
    g.Deno = { env: { get: () => "from-deno" } };
    try {
      expect(readEnv(NAME)).toBe("from-deno");
    } finally {
      delete g.Deno;
      delete process.env[NAME];
    }
  });

  test("an empty Deno value falls through to process.env", () => {
    process.env[NAME] = "from-process";
    g.Deno = { env: { get: () => "" } };
    try {
      expect(readEnv(NAME)).toBe("from-process");
    } finally {
      delete g.Deno;
      delete process.env[NAME];
    }
  });

  test("a permission throw from Deno.env.get reads as unset, not a crash", () => {
    g.Deno = {
      env: {
        get: () => {
          throw new Error("NotCapable: Requires env access");
        },
      },
    };
    try {
      expect(readEnv(NAME)).toBeUndefined();
    } finally {
      delete g.Deno;
    }
  });

  test("a permission throw from process.env reads as unset, not a crash", () => {
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
