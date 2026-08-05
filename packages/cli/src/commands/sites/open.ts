import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import {
  fetchPullZoneHostnames,
  type Hostname,
  hostnameUrl,
  liveHostnames,
} from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { openBrowser } from "../../core/ui.ts";
import { previewZone, reconcilePreviewDomain } from "./api.ts";
import type { RemoteSiteState } from "./constants.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  sitePositionalBuilder,
} from "./interactive.ts";

interface OpenArgs extends SiteSelectorArgs {
  print?: boolean;
}

/** The URL to open: the recorded custom domain when it's live, else the system host. */
export function siteLiveUrl(
  state: RemoteSiteState,
  hostnames: Hostname[],
): string | undefined {
  if (state.domain) {
    const custom = hostnames.find(
      (h) => (h.Value ?? "").toLowerCase() === state.domain?.toLowerCase(),
    );
    if (custom?.Value) {
      return hostnameUrl(custom.Value, {
        hasCertificate: custom.HasCertificate,
        forceSSL: custom.ForceSSL,
      });
    }
  }
  return liveHostnames(hostnames).primary;
}

export const sitesOpenCommand = defineCommand<OpenArgs>({
  command: "open [site]",
  describe: "Open a site's live URL in the browser.",
  examples: [
    ["$0 sites open", "Open the linked site"],
    ["$0 sites open my-site", "Open a specific site"],
    ["$0 sites open --print", "Print the URL instead of opening it"],
  ],

  builder: (yargs) =>
    sitePositionalBuilder(yargs).option("print", {
      type: "boolean",
      default: false,
      describe: "Print the URL instead of opening it in the browser",
    }),

  handler: async ({ site: ref, print, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { site } = await selectSite(client, { site: ref, output });
    const { state } = site;

    const hostnames = await fetchPullZoneHostnames(client, state.pullZoneId);
    // A domain the zone no longer serves must not win over the system host.
    reconcilePreviewDomain(state, previewZone(hostnames, state.domain));
    const url = siteLiveUrl(state, hostnames);
    if (!url) {
      throw new UserError(
        `Site "${state.name}" has no reachable hostname yet.`,
        "Add a domain with `bunny sites domains add`, or deploy first.",
      );
    }

    if (output === "json") {
      logger.log(JSON.stringify({ url }, null, 2));
      return;
    }
    if (print) {
      logger.log(url);
      return;
    }

    logger.info(`Opening ${url}`);
    openBrowser(url);
  },
});
