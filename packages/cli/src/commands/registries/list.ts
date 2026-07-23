import { registriesList } from "@bunny.net/actions";
import { defineActionCommand } from "../../core/define-action-command.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";

export const registryListCommand = defineActionCommand({
  action: registriesList,
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
