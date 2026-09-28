import { describe, expect, test } from "bun:test";
import { sandboxKnownHostsPath } from "@bunny.net/sandbox/known-hosts";
import type { SandboxRecord } from "@/config/schema.ts";
import { sshArgs } from "./ssh-exec.ts";

const record: SandboxRecord = {
  app_id: "app-1",
  agent_token: "secret-token",
  ssh_host: "sandbox.example.net:8023",
};

describe("sshArgs host-key verification", () => {
  const args = sshArgs(record, "uname -a");
  const joined = args.join(" ");

  test("does not disable host-key checking", () => {
    expect(joined).not.toContain("StrictHostKeyChecking=no");
    expect(joined).not.toContain("UserKnownHostsFile=/dev/null");
  });

  test("uses trust-on-first-use against the shared known-hosts file", () => {
    expect(joined).toContain("StrictHostKeyChecking=accept-new");
    expect(args).toContain(`UserKnownHostsFile="${sandboxKnownHostsPath()}"`);
  });

  test("keeps entries plaintext so the SDK can parse the shared file", () => {
    expect(args).toContain("HashKnownHosts=no");
  });

  test("still targets the right host and port and never embeds the token", () => {
    expect(args).toContain("8023");
    expect(args).toContain("root@sandbox.example.net");
    expect(joined).not.toContain("secret-token");
  });
});
