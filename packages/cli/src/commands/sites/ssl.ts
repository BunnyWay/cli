import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import {
  fetchPullZoneHostnames,
  setForceSsl,
  systemHostname,
} from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { withSpinner } from "../../core/ui.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  sitePositionalBuilder,
} from "./interactive.ts";

interface SslArgs extends SiteSelectorArgs {
  "force-ssl"?: boolean;
}

// Toggle Force SSL (HTTP->HTTPS) on the site's `<name>.b-cdn.net` system host (always on bunny's wildcard cert, so no cert is issued); custom domains use `sites domains ssl`.
export const sitesSslCommand = defineCommand<SslArgs>({
  command: "ssl [site]",
  describe: "Force HTTPS on a site's <name>.b-cdn.net address.",
  examples: [
    ["$0 sites ssl", "Force HTTP→HTTPS on the linked site's system host"],
    [
      "$0 sites ssl my-site --no-force-ssl",
      "Allow plain HTTP on the system host",
    ],
  ],

  builder: (yargs) =>
    sitePositionalBuilder(yargs).option("force-ssl", {
      type: "boolean",
      default: true,
      describe:
        "Force HTTP→HTTPS on the system host (default: true). Use --no-force-ssl to allow HTTP.",
    }),

  handler: async (args) => {
    const { site: ref, link, profile, output, verbose, apiKey } = args;
    const force = args["force-ssl"] !== false;

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { site } = await selectSite(client, { site: ref, link, output });
    const { state } = site;

    const systemHost = await withSpinner("Updating Force SSL...", async () => {
      const hostnames = await fetchPullZoneHostnames(client, state.pullZoneId);
      const host = systemHostname(hostnames);
      if (!host) {
        throw new UserError(
          `Couldn't find the system hostname for "${state.name}".`,
        );
      }
      await setForceSsl(client, state.pullZoneId, host, force);
      return host;
    });

    if (output === "json") {
      logger.log(
        JSON.stringify({ hostname: systemHost, forceSSL: force }, null, 2),
      );
      return;
    }

    logger.success(
      force
        ? `${systemHost} now redirects HTTP → HTTPS.`
        : `${systemHost} now serves plain HTTP too.`,
    );
    logger.dim("  Custom domains: bunny sites domains ssl <domain>");
  },
});
