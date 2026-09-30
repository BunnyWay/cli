import { registryRepositories } from "@bunny.net/tools/registry";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";

export const registryListCommand = defineToolCommand({
  tool: registryRepositories,
  command: "list",
  aliases: ["ls"],
  describe: "List repositories in the bunny.net registry.",
  progress: "Fetching repositories...",

  prepare: async () => ({ input: {} }),

  render: (repositories, { output }) => {
    if (repositories.length === 0) {
      logger.info("No repositories found.");
      return;
    }
    logger.log(
      formatTable(
        ["Repository"],
        repositories.map((repository) => [repository]),
        output,
      ),
    );
  },
});
