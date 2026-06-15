import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { loadManifest, removeManifest } from "../../../core/manifest.ts";
import { confirm } from "../../../core/ui.ts";
import { DNS_MANIFEST, type DnsManifest } from "../constants.ts";

interface UnlinkArgs {
  force?: boolean;
}

export const dnsZoneUnlinkCommand = defineCommand<UnlinkArgs>({
  command: "unlink",
  describe: `Remove .bunny/${DNS_MANIFEST}, unlinking this directory from its zone.`,

  builder: (yargs) =>
    yargs.option("force", {
      alias: "f",
      type: "boolean",
      describe: "Skip the confirmation prompt",
    }),

  handler: async ({ force, output }) => {
    const existing = loadManifest<DnsManifest>(DNS_MANIFEST);

    if (!existing.id) {
      if (output === "json") {
        logger.log(JSON.stringify({ unlinked: false, reason: "no-manifest" }));
        return;
      }
      logger.log(`Nothing to unlink: no .bunny/${DNS_MANIFEST} in this tree.`);
      return;
    }

    if (!force) {
      const confirmed = await confirm(
        `Unlink from ${existing.domain ?? existing.id}?`,
      );
      if (!confirmed) {
        logger.log("Unlink cancelled.");
        return;
      }
    }

    removeManifest(DNS_MANIFEST);

    if (output === "json") {
      logger.log(JSON.stringify({ unlinked: true, id: existing.id }));
      return;
    }
    logger.success("Unlinked.");
  },
});
