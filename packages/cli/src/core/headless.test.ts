import { describe, expect, test } from "bun:test";
import { detectHeadless } from "./headless.ts";

describe("detectHeadless", () => {
  test("returns null on a desktop session", () => {
    expect(detectHeadless({ DISPLAY: ":0" }, "linux")).toBeNull();
    expect(detectHeadless({}, "darwin")).toBeNull();
    expect(detectHeadless({}, "win32")).toBeNull();
  });

  test("flags SSH sessions on every platform", () => {
    for (const platform of ["darwin", "linux", "win32"]) {
      expect(detectHeadless({ SSH_CONNECTION: "x" }, platform)?.kind).toBe(
        "ssh",
      );
    }
    expect(detectHeadless({ SSH_TTY: "/dev/pts/0" }, "linux")?.kind).toBe(
      "ssh",
    );
    expect(detectHeadless({ SSH_CLIENT: "x" }, "linux")?.kind).toBe("ssh");
  });

  test("SSH wins over other signals", () => {
    const reason = detectHeadless({ SSH_CONNECTION: "x", CI: "1" }, "linux");
    expect(reason?.kind).toBe("ssh");
  });

  test("flags CI and names the variable that gave it away", () => {
    const reason = detectHeadless({ GITHUB_ACTIONS: "true" }, "linux");
    expect(reason?.kind).toBe("ci");
    expect(reason?.message).toContain("GITHUB_ACTIONS");
  });

  test("ignores false-like CI values", () => {
    expect(detectHeadless({ CI: "false", DISPLAY: ":0" }, "linux")).toBeNull();
    expect(detectHeadless({ CI: "0", DISPLAY: ":0" }, "linux")).toBeNull();
    expect(detectHeadless({ CI: "FALSE" }, "darwin")).toBeNull();
    expect(detectHeadless({ CI: "", DISPLAY: ":0" }, "linux")).toBeNull();
    expect(
      detectHeadless({ CI: "false", GITHUB_ACTIONS: "true" }, "darwin")?.kind,
    ).toBe("ci");
  });

  test("flags a Linux box with no display server", () => {
    expect(detectHeadless({}, "linux")?.kind).toBe("no-display");
    expect(
      detectHeadless({ WAYLAND_DISPLAY: "wayland-0" }, "linux"),
    ).toBeNull();
  });

  test("flags platforms with no browser opener", () => {
    expect(detectHeadless({ DISPLAY: ":0" }, "freebsd")?.kind).toBe(
      "unsupported-platform",
    );
  });
});
