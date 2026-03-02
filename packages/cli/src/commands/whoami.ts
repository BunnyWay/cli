import { defineCommand } from "../core/define-command.ts";
import { resolveConfig } from "../config/index.ts";
import { createCoreClient } from "@bunny.net/api";
import { spinner } from "../core/ui.ts";
import { logger } from "../core/logger.ts";
import { UserError } from "../core/errors.ts";
import { clientOptions } from "../core/client-options.ts";

const COMMAND = "whoami";
const DESCRIPTION = "Show the currently authenticated account.";

/**
 * Display information about the currently authenticated account.
 *
 * Verifies the configured API key against the Bunny API and shows the
 * active profile, authentication source, and key roles.
 *
 * @example
 * ```bash
 * bunny whoami
 *
 * bunny whoami --output json
 *
 * bunny whoami --profile staging
 * ```
 */
export const whoamiCommand = defineCommand({
  command: COMMAND,
  describe: DESCRIPTION,

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey);

    if (!config.apiKey) {
      throw new UserError(
        "Not logged in.",
        'Run "bunny auth login" to authenticate.',
      );
    }

    logger.debug(`Profile: ${config.profile || "(none)"}`, verbose);
    logger.debug(`API URL: ${config.apiUrl ?? "(default)"}`, verbose);

    const client = createCoreClient(clientOptions(config, verbose));

    const spin = spinner("Verifying credentials...");
    spin.start();

    const { data, error } = await client.GET("/user");

    spin.stop();

    if (error || !data) {
      throw new UserError(
        "Authentication failed.",
        "Your API key may be invalid or expired. Run \"bunny auth login\" to re-authenticate.",
      );
    }

    const name = [data.FirstName, data.LastName].filter(Boolean).join(" ") || null;
    const email = data.Email ?? null;
    const roles = data.Roles ?? [];

    logger.debug(`Name: ${name}`, verbose);
    logger.debug(`Email: ${email}`, verbose);
    logger.debug(`Roles: ${roles.length > 0 ? roles.join(", ") : "(none)"}`, verbose);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            name,
            email,
            profile: config.profile || null,
            source: config.profile ? "config" : "env",
            roles,
          },
          null,
          2,
        ),
      );
      return;
    }

    const maskedKey = config.apiKey.slice(0, 8) + "..." + config.apiKey.slice(-4);
    const greeting = [name, email ? `(${email})` : null]
      .filter(Boolean)
      .join(" ");

    logger.log();
    logger.log(`Logged in as ${greeting || maskedKey} 🐇`);
    logger.log();
    if (config.profile) {
      logger.dim(`Profile: ${config.profile}`);
    }
    logger.dim("You can use `bunny config profile` to manage multiple accounts.");
  },
});
