import { registriesList } from "@bunny.net/tools/registries";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";

export const registryListCommand = defineToolCommand({
  tool: registriesList,
  command: "list",
  describe: "List container registries.",
  aliases: ["ls"],
  progress: "Fetching registries...",

  prepare: async () => ({ input: {} }),

  render: (registries, { output }) => {
    if (registries.length === 0) {
      logger.info("No registries configured.");
      return;
    }

    const rows = registries.map((r) => [
      String(r.id),
      r.name,
      r.hostname ?? "",
      r.username ?? "",
    ]);

    logger.log(
      formatTable(["ID", "Name", "Hostname", "Username"], rows, output),
    );
  },
});
