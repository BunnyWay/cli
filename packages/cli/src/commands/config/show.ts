import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatKeyValue } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";

export const configShowCommand = defineCommand({
  command: "show",
  describe: "Show the loaded configuration.",

  handler: async ({ profile, output, apiKey }) => {
    const cfg = resolveConfig(profile, apiKey);

    if (output === "json") {
      logger.log(JSON.stringify(cfg, null, 2));
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "Profile", value: cfg.profile || "(env)" },
          { key: "API URL", value: cfg.apiUrl ?? "(default)" },
          {
            key: "API Key",
            value: cfg.apiKey ? `${cfg.apiKey.slice(0, 8)}...` : "(not set)",
          },
        ],
        output,
      ),
    );
  },
});
