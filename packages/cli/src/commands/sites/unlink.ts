import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, removeManifest } from "@/core/manifest.ts";
import { SITES_MANIFEST, type SiteManifest } from "./constants.ts";

export const sitesUnlinkCommand = defineCommand({
  command: "unlink",
  describe: "Unlink the current directory from its site.",
  examples: [["$0 sites unlink", "Remove the .bunny/site.json link"]],

  handler: async ({ output }) => {
    const manifest = loadManifest<SiteManifest>(SITES_MANIFEST);
    removeManifest(SITES_MANIFEST);

    if (output === "json") {
      logger.log(JSON.stringify({ unlinked: manifest.id ?? null }, null, 2));
      return;
    }

    if (manifest.id) {
      logger.success(
        `Unlinked from ${manifest.name ?? manifest.id}. The site itself was not touched.`,
      );
    } else {
      logger.info("This directory is not linked to a site.");
    }
  },
});
