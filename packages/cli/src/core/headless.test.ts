import { describe, expect, test } from "bun:test";
import { detectHeadless } from "./headless.ts";

// Every signal comes from the fixture, so these pass inside a container too.
const detect = (env: Record<string, string | undefined>, platform: string) =>
  detectHeadless(env, platform, () => false);

describe("detectHeadless", () => {
  test("returns null on a desktop session", () => {
    expect(detect({ DISPLAY: ":0" }, "linux")).toBeNull();
    expect(detect({}, "darwin")).toBeNull();
    expect(detect({}, "win32")).toBeNull();
  });

  test("flags SSH sessions on every platform", () => {
    for (const platform of ["darwin", "linux", "win32"]) {
      expect(detect({ SSH_CONNECTION: "x" }, platform)?.kind).toBe("ssh");
    }
    expect(detect({ SSH_TTY: "/dev/pts/0" }, "linux")?.kind).toBe("ssh");
    expect(detect({ SSH_CLIENT: "x" }, "linux")?.kind).toBe("ssh");
  });

  test("SSH wins over other signals", () => {
    const reason = detect({ SSH_CONNECTION: "x", CI: "1" }, "linux");
    expect(reason?.kind).toBe("ssh");
  });

  test("flags CI and names the variable that gave it away", () => {
    const reason = detect({ GITHUB_ACTIONS: "true" }, "linux");
    expect(reason?.kind).toBe("ci");
    expect(reason?.message).toContain("GITHUB_ACTIONS");
  });

  test("ignores false-like CI values", () => {
    expect(detect({ CI: "false", DISPLAY: ":0" }, "linux")).toBeNull();
    expect(detect({ CI: "0", DISPLAY: ":0" }, "linux")).toBeNull();
    expect(detect({ CI: "FALSE" }, "darwin")).toBeNull();
    expect(detect({ CI: "", DISPLAY: ":0" }, "linux")).toBeNull();
    expect(
      detect({ CI: "false", GITHUB_ACTIONS: "true" }, "darwin")?.kind,
    ).toBe("ci");
  });

  test("flags a Linux box with no display server", () => {
    expect(detect({}, "linux")?.kind).toBe("no-display");
    expect(detect({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBeNull();
  });

  test("flags platforms with no browser opener", () => {
    expect(detect({ DISPLAY: ":0" }, "freebsd")?.kind).toBe(
      "unsupported-platform",
    );
  });

  test("flags a container by its root filesystem marker", () => {
    for (const marker of ["/.dockerenv", "/run/.containerenv"]) {
      expect(
        detectHeadless({ DISPLAY: ":0" }, "linux", (path) => path === marker)
          ?.kind,
      ).toBe("container");
    }
  });
});
