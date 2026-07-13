import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeKnownHost, verifyKnownHost } from "./known-hosts.ts";

const dirs: string[] = [];
function storePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "bunny-known-hosts-"));
  dirs.push(dir);
  return join(dir, "nested", "sandbox_known_hosts");
}

/** Build a minimal SSH public-key blob: length-prefixed algorithm + body. */
function hostKey(type: string, body: string): Buffer {
  const name = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(name.length, 0);
  return Buffer.concat([len, name, Buffer.from(body)]);
}

const keyA = hostKey("ssh-ed25519", "AAAA-key-a");
const keyB = hostKey("ssh-ed25519", "BBBB-key-b");

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("verifyKnownHost trust-on-first-use", () => {
  test("trusts the first key and records an OpenSSH-format line", () => {
    const path = storePath();
    expect(verifyKnownHost("host", 8023, keyA, path)).toBe(true);
    expect(readFileSync(path, "utf8").trim()).toBe(
      `[host]:8023 ssh-ed25519 ${keyA.toString("base64")}`,
    );
  });

  test("accepts the same key on a later connection", () => {
    const path = storePath();
    verifyKnownHost("host", 8023, keyA, path);
    expect(verifyKnownHost("host", 8023, keyA, path)).toBe(true);
  });

  test("rejects a changed key for a known host (impersonation / rotation)", () => {
    const path = storePath();
    verifyKnownHost("host", 8023, keyA, path);
    expect(verifyKnownHost("host", 8023, keyB, path)).toBe(false);
  });

  test("rejects a new key type for a known host (algorithm downgrade)", () => {
    const path = storePath();
    verifyKnownHost("host", 8023, keyA, path);
    const rsaKey = hostKey("ssh-rsa", "CCCC-key-c");
    expect(verifyKnownHost("host", 8023, rsaKey, path)).toBe(false);
    expect(readFileSync(path, "utf8")).not.toContain("ssh-rsa");
    expect(verifyKnownHost("host", 8023, keyA, path)).toBe(true);
  });

  test("tracks each host independently", () => {
    const path = storePath();
    verifyKnownHost("host-a", 8023, keyA, path);
    expect(verifyKnownHost("host-b", 8023, keyB, path)).toBe(true);
    expect(verifyKnownHost("host-a", 8023, keyA, path)).toBe(true);
  });

  test("honors a key already pinned by OpenSSH in the shared file", () => {
    const path = storePath();
    // A line OpenSSH would have written to the shared file.
    verifyKnownHost("host", 8023, keyA, path); // creates the dir
    writeFileSync(path, `[host]:8023 ssh-ed25519 ${keyA.toString("base64")}\n`);
    expect(verifyKnownHost("host", 8023, keyA, path)).toBe(true);
    expect(verifyKnownHost("host", 8023, keyB, path)).toBe(false);
  });

  test("accepts a pin that follows a stale mismatched line", () => {
    const path = storePath();
    verifyKnownHost("host", 8023, keyB, path);
    writeFileSync(
      path,
      `[host]:8023 ssh-ed25519 ${keyA.toString("base64")}\n` +
        `[host]:8023 ssh-ed25519 ${keyB.toString("base64")}\n`,
    );
    expect(verifyKnownHost("host", 8023, keyB, path)).toBe(true);
    expect(verifyKnownHost("host", 8023, keyA, path)).toBe(true);
    const other = hostKey("ssh-ed25519", "DDDD-key-d");
    expect(verifyKnownHost("host", 8023, other, path)).toBe(false);
  });

  test("uses a bare hostname (no brackets) for the default SSH port", () => {
    const path = storePath();
    verifyKnownHost("host", 22, keyA, path);
    expect(readFileSync(path, "utf8")).toContain("host ssh-ed25519");
  });

  test("rejects a malformed key blob", () => {
    const path = storePath();
    expect(verifyKnownHost("host", 8023, Buffer.from([1, 2]), path)).toBe(
      false,
    );
  });
});

describe("removeKnownHost", () => {
  test("drops a host's pin so the next connection re-pins it", () => {
    const path = storePath();
    verifyKnownHost("host", 8023, keyA, path);
    removeKnownHost("host", 8023, path);
    expect(readFileSync(path, "utf8")).not.toContain("host");
    expect(verifyKnownHost("host", 8023, keyB, path)).toBe(true);
  });

  test("only removes the targeted host and port", () => {
    const path = storePath();
    verifyKnownHost("host-a", 8023, keyA, path);
    verifyKnownHost("host-b", 8023, keyB, path);
    removeKnownHost("host-a", 8023, path);
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("[host-a]:8023");
    expect(text).toContain("[host-b]:8023");
    expect(verifyKnownHost("host-b", 8023, keyB, path)).toBe(true);
  });

  test("removes every entry recorded for the host", () => {
    const path = storePath();
    verifyKnownHost("host", 8023, keyA, path);
    const rsaKey = hostKey("ssh-rsa", "CCCC-key-c");
    writeFileSync(
      path,
      `[host]:8023 ssh-ed25519 ${keyA.toString("base64")}\n` +
        `[host]:8023 ssh-rsa ${rsaKey.toString("base64")}\n`,
    );
    removeKnownHost("host", 8023, path);
    expect(readFileSync(path, "utf8").trim()).toBe("");
  });

  test("keeps other aliases sharing a comma-separated line", () => {
    const path = storePath();
    verifyKnownHost("host", 8023, keyA, path); // creates the dir
    writeFileSync(
      path,
      `[host]:8023,[alias]:8023 ssh-ed25519 ${keyA.toString("base64")}\n`,
    );
    removeKnownHost("host", 8023, path);
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("[host]:8023");
    expect(text).toBe(`[alias]:8023 ssh-ed25519 ${keyA.toString("base64")}\n`);
    expect(verifyKnownHost("alias", 8023, keyA, path)).toBe(true);
  });

  test("is a no-op when the host is absent or the file is missing", () => {
    const path = storePath();
    expect(() => removeKnownHost("host", 8023, path)).not.toThrow();
    verifyKnownHost("host", 8023, keyA, path);
    removeKnownHost("other", 8023, path);
    expect(readFileSync(path, "utf8")).toContain("[host]:8023");
  });
});
