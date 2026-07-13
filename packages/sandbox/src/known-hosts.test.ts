import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyKnownHost } from "./known-hosts.ts";

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
