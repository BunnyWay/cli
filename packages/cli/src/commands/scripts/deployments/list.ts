import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";
import {
  fetchScriptHostnames,
  logLiveHostnames,
} from "@/commands/scripts/api.ts";
import {
  type ScriptSelectorArgs,
  scriptSelectorBuilder,
  selectScript,
} from "@/commands/scripts/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatDateTime, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { spinner } from "@/core/ui.ts";

type EdgeScriptRelease = components["schemas"]["EdgeScriptReleaseModel"];
type EdgeScriptReleaseStatus = components["schemas"]["EdgeScriptReleaseStatus"];

const COMMAND = "list [id]";
const ALIASES = ["ls"] as const;
const DESCRIPTION = "List deployments for an Edge Script.";

const RELEASE_STATUS_LIVE: EdgeScriptReleaseStatus = 1;

const STATUS_LABELS: Record<EdgeScriptReleaseStatus, string> = {
  0: "Archived",
  1: "Live",
};

type ListArgs = ScriptSelectorArgs;

/**
 * List all deployments (releases) for an Edge Script.
 *
 * Shows each release's ID, status, author, release date, and publish date
 * in a table. Deleted releases are excluded. If a release is currently live
 * and the script has a linked pull zone, the hostname is printed at the end.
 *
 * When no ID is given it falls back to the linked script from the local
 * manifest, then to an interactive picker (offering to link the directory
 * for next time).
 *
 * @example
 * ```bash
 * # List deployments for linked script
 * bunny scripts deployments list
 *
 * # List by script ID
 * bunny scripts deployments list 12345
 *
 * # Short alias
 * bunny scripts deployments ls
 *
 * # JSON output
 * bunny scripts deployments list --output json
 * ```
 */
export const scriptsDeploymentsListCommand = defineCommand<ListArgs>({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts deployments list", "List deployments for linked script"],
    ["$0 scripts deployments list 12345", "List by script ID"],
    ["$0 scripts deployments list --output json", "JSON output"],
  ],

  builder: (yargs) => scriptSelectorBuilder(yargs),

  handler: async ({ id: rawId, link, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const client = createComputeClient(options);

    const { script, id, offerLink } = await selectScript(client, {
      id: rawId,
      link,
      output,
    });

    const spin = spinner("Fetching deployments...");
    spin.start();

    const { data } = await client
      .GET("/compute/script/{id}/releases", {
        params: { path: { id } },
      })
      .finally(() => spin.stop());

    const releases = (data?.Items ?? []).filter(
      (r: EdgeScriptRelease) => !r.Deleted,
    );

    if (output === "json") {
      logger.log(JSON.stringify(releases, null, 2));
      return;
    }

    if (releases.length === 0) {
      logger.info("No deployments found for this script.");
      await offerLink();
      return;
    }

    if (script.Name) {
      logger.info(`Deployments for ${script.Name}:`);
      logger.log();
    }

    logger.log(
      formatTable(
        ["ID", "Status", "Author", "Released", "Published"],
        releases.map((r: EdgeScriptRelease) => [
          String(r.Id ?? ""),
          r.Status === RELEASE_STATUS_LIVE
            ? `● ${STATUS_LABELS[r.Status]}`
            : `○ ${STATUS_LABELS[r.Status ?? 0]}`,
          r.Author ?? "",
          formatDateTime(r.DateReleased),
          formatDateTime(r.DatePublished),
        ]),
        output,
      ),
    );

    if (
      releases.some((r: EdgeScriptRelease) => r.Status === RELEASE_STATUS_LIVE)
    ) {
      const coreClient = createCoreClient(options);
      const hostnames = await fetchScriptHostnames(coreClient, script, verbose);
      logger.log();
      logLiveHostnames(script, hostnames);
    }

    await offerLink();
  },
});
