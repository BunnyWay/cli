import { registriesList } from "@bunny.net/tools/registries";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";

// The account's own connections sit alongside registries bunny.net provides, which cannot be edited or removed.
function source(registry: {
  platformManaged: boolean;
  public: boolean;
}): string {
  if (registry.platformManaged) return "bunny.net";
  return registry.public ? "Public" : "Connected";
}

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
      source(r),
    ]);

    logger.log(
      formatTable(
        ["ID", "Name", "Hostname", "Username", "Source"],
        rows,
        output,
      ),
    );
  },
});
