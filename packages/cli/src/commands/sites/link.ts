import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { SITES_MANIFEST, type SiteManifest } from "./constants.ts";
import { selectSite } from "./interactive.ts";

interface LinkArgs {
  site?: string;
}

export const sitesLinkCommand = defineCommand<LinkArgs>({
  command: "link [site]",
  describe: "Link the current directory to a site.",
  examples: [
    ["$0 sites link", "Interactive selection"],
    ["$0 sites link my-site", "Link by name or storage zone ID"],
  ],

  builder: (yargs) =>
    yargs.positional("site", {
      type: "string",
      describe: "Site name or storage zone ID",
    }),

  handler: async ({ site: ref, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // `link: true` makes the picker's offerLink a no-op prompt-wise, but we
    // save explicitly below so the ref/manifest paths also link.
    const { site } = await selectSite(client, {
      site: ref,
      link: false,
      output,
    });

    saveManifest<SiteManifest>(SITES_MANIFEST, {
      id: site.state.storageZoneId,
      name: site.state.name,
    });

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { id: site.state.storageZoneId, name: site.state.name },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(
      `Linked to ${site.state.name} (${site.state.storageZoneId}).`,
    );
  },
});
