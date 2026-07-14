import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import {
  fetchPullZoneHostnames,
  setForceSsl,
} from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  sitePositionalBuilder,
} from "./interactive.ts";

interface SslArgs extends SiteSelectorArgs {
  "force-ssl"?: boolean;
}

/**
 * Toggle Force SSL (HTTP→HTTPS redirect) on the site's `<name>.b-cdn.net`
 * system host. It always carries bunny's wildcard certificate, so no cert is
 * issued here. Custom domains are managed via `sites domains ssl`.
 */
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

    const spin = spinner("Updating Force SSL...");
    spin.start();
    let systemHost: string | null | undefined;
    try {
      const hostnames = await fetchPullZoneHostnames(client, state.pullZoneId);
      systemHost = hostnames.find((h) => h.IsSystemHostname)?.Value;
      if (!systemHost) {
        throw new UserError(
          `Couldn't find the system hostname for "${state.name}".`,
        );
      }
      await setForceSsl(client, state.pullZoneId, systemHost, force);
    } finally {
      spin.stop();
    }

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
