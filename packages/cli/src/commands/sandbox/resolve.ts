import { Sandbox } from "@bunny.net/sandbox";
import { getSandbox, resolveConfig } from "../../config/index.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";

/** A `sandbox:path` reference to a file or directory inside a sandbox. */
export interface RemoteRef {
  sandbox: string;
  path: string;
}

/**
 * Parse a `sandbox:path` reference. Returns null for local paths — an
 * absolute/relative path, a `~` path, or anything whose prefix looks like a
 * directory rather than a sandbox name.
 */
export function parseRemoteRef(ref: string): RemoteRef | null {
  const idx = ref.indexOf(":");
  if (idx <= 0) return null;
  const sandbox = ref.slice(0, idx);
  const path = ref.slice(idx + 1);
  if (!path) return null;
  if (
    sandbox.includes("/") ||
    sandbox.includes(".") ||
    sandbox.startsWith("~")
  ) {
    return null;
  }
  return { sandbox, path };
}

/** Rebuild a Sandbox handle for API calls from a stored sandbox record. */
export function sandboxFromName(
  name: string,
  profile: string,
  apiKey: string | undefined,
  verbose: boolean | undefined,
): Sandbox {
  const record = getSandbox(name);
  if (!record) {
    throw new UserError(
      `No sandbox named "${name}" found. Run: bunny sandbox create ${name}`,
    );
  }

  const config = resolveConfig(profile, apiKey, verbose);
  return Sandbox.fromHandle(
    {
      appId: record.app_id,
      name,
      agentToken: record.agent_token,
      sshHost: record.ssh_host ?? "",
    },
    {
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      verbose,
      onDebug: (msg) => logger.debug(msg, true),
    },
  );
}

/** Like sandboxFromName, but for SSH/SFTP commands that need an endpoint. */
export function connectSandbox(
  name: string,
  profile: string,
  apiKey: string | undefined,
  verbose: boolean | undefined,
): Sandbox {
  const record = getSandbox(name);
  if (record && !record.ssh_host) {
    throw new UserError(
      `Sandbox "${name}" has no SSH endpoint recorded. Re-create it.`,
    );
  }
  // A missing record gets sandboxFromName's "no sandbox named" error.
  return sandboxFromName(name, profile, apiKey, verbose);
}
