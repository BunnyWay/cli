import { Sandbox } from "@bunny.net/sandbox";
import { getSandbox, resolveConfig } from "../../../config/index.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";

/** Rebuild a Sandbox handle for API calls from a stored sandbox record. */
export function sandboxFromName(
  name: string,
  profile: string,
  apiKey: string | undefined,
  verbose: boolean | undefined,
): Sandbox {
  const record = getSandbox(name);
  if (!record) throw new UserError(`No sandbox named "${name}" found.`);

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
