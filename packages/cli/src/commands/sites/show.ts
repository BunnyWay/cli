import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import {
  formatDateTime,
  formatKeyValue,
  formatTable,
} from "../../core/format.ts";
import {
  fetchPullZoneHostnames,
  hostnameUrl,
  toSafeHostname,
} from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { withSpinner } from "../../core/ui.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteLinkOption,
  sitePositionalBuilder,
} from "./interactive.ts";

type ShowArgs = SiteSelectorArgs;

export const sitesShowCommand = defineCommand<ShowArgs>({
  command: "show [site]",
  describe: "Show a site's resources, domains, and current deploy.",
  examples: [
    ["$0 sites show", "Show the linked site"],
    ["$0 sites show my-site", "Show a specific site"],
    ["$0 sites show --output json", "JSON output"],
  ],

  builder: (yargs) => siteLinkOption(sitePositionalBuilder(yargs)),

  handler: async ({ site: ref, link, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { site, offerLink } = await selectSite(client, {
      site: ref,
      link,
      output,
    });
    const { state } = site;

    // Hostnames are informational; a fetch failure shouldn't hide the site (null, not [], so a failed read never reads as "no hostnames").
    const fetched = await withSpinner("Fetching hostnames...", () =>
      fetchPullZoneHostnames(client, state.pullZoneId).catch(() => null),
    );
    const hostnames = fetched ?? [];

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            ...state,
            hostnames: hostnames.map(toSafeHostname),
          },
          null,
          2,
        ),
      );
      return;
    }

    const current = state.deploys.find((d) => d.id === state.current);
    logger.log(
      formatKeyValue(
        [
          { key: "Site", value: state.name },
          { key: "Storage zone", value: String(state.storageZoneId) },
          { key: "Pull zone", value: String(state.pullZoneId) },
          { key: "Router script", value: String(state.scriptId) },
          { key: "Domain", value: state.domain ?? "-" },
          { key: "Current deploy", value: state.current ?? "-" },
          {
            key: "Deployed",
            value: current ? formatDateTime(current.createdAt) : "-",
          },
          { key: "Previous deploy", value: state.previous ?? "-" },
          { key: "Deploys", value: String(state.deploys.length) },
        ],
        output,
      ),
    );

    if (hostnames.length > 0) {
      logger.log();
      logger.log(
        formatTable(
          ["Domain", "Type", "SSL", "Force SSL"],
          hostnames.map((h) => [
            hostnameUrl(h.Value ?? "", {
              hasCertificate: h.HasCertificate,
              forceSSL: h.ForceSSL,
            }),
            h.IsSystemHostname ? "System" : "Custom",
            h.HasCertificate ? "Yes" : "No",
            h.ForceSSL ? "Yes" : "No",
          ]),
          output,
        ),
      );
    }

    await offerLink();
  },
});
