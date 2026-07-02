import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxRecord } from "../../config/schema.ts";

export const WORKPLACE = "/workplace";

/** Single-quote a value for safe use in a remote shell command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build an inline `KEY='value' ` prefix that sets env vars for the command
 * that follows. Returns "" when there are none. Keys are assumed validated.
 */
export function envPrefix(env: Record<string, string>): string {
  const parts = Object.entries(env).map(
    ([key, value]) => `${key}=${shellQuote(value)}`,
  );
  return parts.length ? `${parts.join(" ")} ` : "";
}

export function sshArgs(
  record: SandboxRecord,
  remoteCmd: string,
  options: { tty?: boolean } = {},
): string[] {
  const sshHost = record.ssh_host ?? "localhost";
  const [host, portStr] = (
    sshHost.includes(":") ? sshHost.split(":") : [sshHost, "8023"]
  ) as [string, string];

  return [
    "ssh",
    ...(options.tty ? ["-t"] : []),
    "-p",
    portStr,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "LogLevel=ERROR",
    `root@${host}`,
    remoteCmd,
  ];
}

/**
 * Runs `fn` with an environment that makes OpenSSH use a temp askpass helper
 * to supply the sandbox token. The helper reads BUNNY_SSH_TOKEN so the token
 * is never written to disk — only held in the process environment.
 * The temp directory is removed when `fn` resolves or rejects.
 *
 * Requires OpenSSH ≥ 8.4 (SSH_ASKPASS_REQUIRE=force). macOS ships ≥ 8.6.
 */
export async function withSshEnv<T>(
  record: SandboxRecord,
  fn: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "bunny-ssh-"));
  const scriptPath = join(dir, "askpass");
  await Bun.write(scriptPath, `#!/bin/sh\nprintf '%s' "$BUNNY_SSH_TOKEN"\n`);
  await chmod(scriptPath, 0o700);
  try {
    return await fn({
      ...process.env,
      BUNNY_SSH_TOKEN: record.agent_token,
      SSH_ASKPASS: scriptPath,
      SSH_ASKPASS_REQUIRE: "force",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runSshCommand(
  record: SandboxRecord,
  remoteCmd: string,
): Promise<number> {
  return withSshEnv(record, async (env) => {
    const proc = Bun.spawn(sshArgs(record, remoteCmd), {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env,
    });
    return proc.exited;
  });
}
