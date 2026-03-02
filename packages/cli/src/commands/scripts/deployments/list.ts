import type { components } from "@bunny.net/api/generated/compute.d.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { resolveConfig } from "../../../config/index.ts";
import { createComputeClient } from "@bunny.net/api";
import { spinner } from "../../../core/ui.ts";
import { logger } from "../../../core/logger.ts";
import { formatDateTime, formatTable } from "../../../core/format.ts";
import { resolveManifestId } from "../../../core/manifest.ts";
import { SCRIPT_MANIFEST } from "../constants.ts";
import { clientOptions } from "../../../core/client-options.ts";

type EdgeScript = components["schemas"]["EdgeScriptModel"];
type EdgeScriptRelease = components["schemas"]["EdgeScriptReleaseModel"];
type EdgeScriptReleaseStatus = components["schemas"]["EdgeScriptReleaseStatus"];

const COMMAND = "list [id]";
const ALIASES = ["ls"] as const;
const DESCRIPTION = "List deployments for an Edge Script.";

const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";

const RELEASE_STATUS_LIVE: EdgeScriptReleaseStatus = 1;

const STATUS_LABELS: Record<EdgeScriptReleaseStatus, string> = {
  0: "Archived",
  1: "Live",
};

interface ListArgs {
  [ARG_ID]?: EdgeScript["Id"];
}

/**
 * List all deployments (releases) for an Edge Script.
 *
 * Shows each release's ID, status, author, release date, and publish date
 * in a table. Deleted releases are excluded. If a release is currently live
 * and the script has a linked pull zone, the hostname is printed at the end.
 *
 * Falls back to the linked script ID from the local manifest when no
 * explicit ID is provided.
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

  builder: (yargs) =>
    yargs.positional(ARG_ID, {
      type: "number",
      describe: ARG_ID_DESCRIPTION,
    }),

  handler: async ({ [ARG_ID]: rawId, profile, output, verbose, apiKey }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");
    const config = resolveConfig(profile, apiKey);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Fetching deployments...");
    spin.start();

    const [releasesResult, scriptResult] = await Promise.all([
      client.GET("/compute/script/{id}/releases", {
        params: { path: { id } },
      }),
      client.GET("/compute/script/{id}", {
        params: { path: { id } },
      }),
    ]);

    spin.stop();

    const releases = (releasesResult.data?.Items ?? []).filter(
      (r: EdgeScriptRelease) => !r.Deleted,
    );

    if (output === "json") {
      logger.log(JSON.stringify(releases, null, 2));
      return;
    }

    if (releases.length === 0) {
      logger.info("No deployments found for this script.");
      return;
    }

    const script = scriptResult.data;
    const hostname = script?.LinkedPullZones?.[0]?.DefaultHostname ?? undefined;

    if (script?.Name) {
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
      hostname &&
      releases.some((r: EdgeScriptRelease) => r.Status === RELEASE_STATUS_LIVE)
    ) {
      logger.log();
      logger.info(`Live at: ${hostname}`);
    }
  },
});
