import { loadConfigFile } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";

export const sandboxListCommand = defineCommand({
  command: "list",
  aliases: ["ls"],
  describe: "List all sandboxes.",
  examples: [["$0 sandbox list", "List all sandboxes"]],

  handler: async ({ output }) => {
    const sandboxes = Object.entries(loadConfigFile()?.sandboxes ?? {});

    if (output === "json") {
      logger.log(JSON.stringify(Object.fromEntries(sandboxes), null, 2));
      return;
    }

    if (sandboxes.length === 0) {
      logger.info("No sandboxes found. Run: bunny sandbox create");
      return;
    }

    logger.log(
      formatTable(
        ["Name", "App ID", "SSH"],
        sandboxes.map(([name, s]) => [name, s.app_id, s.ssh_host ?? ""]),
        output,
      ),
    );
  },
});
