import { describe, expect, test } from "bun:test";
import {
  createProgramStatus,
  formatProgramStatus,
  formatProgramStatusClear,
  programStatusWriter,
} from "./program-status.ts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("formatProgramStatus", () => {
  test("emits OSC 7501 with state, app, and a base64 message", () => {
    expect(
      formatProgramStatus({ state: "working", msg: "bunny db list" }),
    ).toBe(
      `\x1b]7501;state=working:app=bunny:msg=${b64("bunny db list")}\x1b\\`,
    );
  });

  test("includes kind only for blocked and progress only for working/blocked", () => {
    expect(
      formatProgramStatus({ state: "blocked", kind: "auth", progress: 40 }),
    ).toBe("\x1b]7501;state=blocked:app=bunny:kind=auth:progress=40\x1b\\");
    expect(
      formatProgramStatus({ state: "done", kind: "auth", progress: 100 }),
    ).toBe("\x1b]7501;state=done:app=bunny\x1b\\");
  });

  test("clamps and rounds progress", () => {
    expect(formatProgramStatus({ state: "working", progress: 140 })).toContain(
      ":progress=100",
    );
    expect(formatProgramStatus({ state: "working", progress: -3 })).toContain(
      ":progress=0",
    );
    expect(formatProgramStatus({ state: "working", progress: 33.6 })).toContain(
      ":progress=34",
    );
    expect(
      formatProgramStatus({ state: "working", progress: NaN }),
    ).not.toContain("progress");
  });

  test("strips control characters from the message and keeps UTF-8", () => {
    const out = formatProgramStatus({
      state: "error",
      msg: "line one\nline two\x1b[31m ✓",
    });
    expect(out).toBe(
      `\x1b]7501;state=error:app=bunny:msg=${b64("line one line two [31m ✓")}\x1b\\`,
    );
  });

  test("drops an empty message after stripping", () => {
    expect(formatProgramStatus({ state: "idle", msg: "\n\t" })).toBe(
      "\x1b]7501;state=idle:app=bunny\x1b\\",
    );
  });

  test("trims the message to the spec's decoded byte cap without splitting a character", () => {
    const out = formatProgramStatus({
      state: "working",
      msg: "é".repeat(2000),
    });
    const encoded = out.split("msg=")[1]?.split("\x1b")[0] ?? "";
    const decoded = Buffer.from(encoded, "base64");
    expect(decoded.byteLength).toBeLessThanOrEqual(2048);
    expect(decoded.toString("utf8")).toBe("é".repeat(1024));
    expect(encoded.length).toBeLessThanOrEqual(2732);
  });

  test("clear removes the app's record", () => {
    expect(formatProgramStatusClear()).toBe(
      "\x1b]7501;state=clear:app=bunny\x1b\\",
    );
  });
});

describe("programStatusWriter", () => {
  const tty = { isTTY: true, write: () => {} };
  const pipe = { isTTY: false, write: () => {} };

  test("prefers stderr, falls back to stdout, and is off with no terminal", () => {
    const seen: string[] = [];
    const err = { isTTY: true, write: (s: string) => seen.push(`err:${s}`) };
    const out = { isTTY: true, write: (s: string) => seen.push(`out:${s}`) };
    programStatusWriter({}, out, err)?.("x");
    programStatusWriter({}, out, pipe)?.("y");
    expect(seen).toEqual(["err:x", "out:y"]);
    expect(programStatusWriter({}, pipe, pipe)).toBeNull();
  });

  test("honours the opt-out variable and dumb terminals", () => {
    expect(
      programStatusWriter({ BUNNYNET_NO_PROGRAM_STATUS: "1" }, tty, tty),
    ).toBeNull();
    expect(programStatusWriter({ TERM: "dumb" }, tty, tty)).toBeNull();
    expect(
      programStatusWriter({ TERM: "xterm-ghostty" }, tty, tty),
    ).not.toBeNull();
  });
});

describe("createProgramStatus", () => {
  test("resume restores the last non-blocked report after a prompt", () => {
    const sent: string[] = [];
    const status = createProgramStatus((s) => sent.push(s));
    status.working("deploying");
    status.blocked("permission", "Continue?");
    status.resume();
    expect(sent).toEqual([
      formatProgramStatus({ state: "working", msg: "deploying" }),
      formatProgramStatus({
        state: "blocked",
        kind: "permission",
        msg: "Continue?",
      }),
      formatProgramStatus({ state: "working", msg: "deploying" }),
    ]);
  });

  test("resume with nothing to go back to clears the record", () => {
    const sent: string[] = [];
    const status = createProgramStatus((s) => sent.push(s));
    status.blocked("question", "Which one?");
    status.resume();
    expect(sent[1]).toBe(formatProgramStatusClear());
  });

  test("a null writer is a silent no-op", () => {
    const status = createProgramStatus(null);
    expect(status.enabled).toBe(false);
    expect(() => {
      status.working("x");
      status.done();
      status.clear();
    }).not.toThrow();
  });
});

describe("redaction", () => {
  test("drops URL query strings and userinfo from messages, any scheme", () => {
    const out = formatProgramStatus({
      state: "error",
      msg: "Failed: https://user:pw@h.test/p?token=S#frag and libsql://db.test?authToken=S2 ok",
    });
    const decoded = Buffer.from(
      out.split("msg=")[1]?.split("\x1b")[0] ?? "",
      "base64",
    ).toString("utf8");
    expect(decoded).toBe(
      "Failed: https://[redacted]@h.test/p?[redacted]#frag and libsql://db.test?[redacted] ok",
    );
    expect(decoded).not.toContain("S2");
    expect(decoded).not.toContain("pw");
  });
});
