import { loadConfigFile } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";

export const profileListCommand = defineCommand({
  command: "list",
  aliases: ["ls"],
  describe: "List configured profiles.",

  handler: async ({ output }) => {
    const file = loadConfigFile();
    const profiles = file?.profiles ?? {};
    const names = Object.keys(profiles);

    if (output === "json") {
      logger.log(JSON.stringify(names, null, 2));
      return;
    }

    if (names.length === 0) {
      logger.log("No profiles configured.");
      return;
    }

    logger.log(
      formatTable(
        ["Name", "API Key"],
        names.map((name) => {
          const key = profiles[name]?.api_key ?? "";
          const masked =
            key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "••••";
          return [name, masked];
        }),
        output,
      ),
    );
  },
});
