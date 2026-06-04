import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { resolveManifestId } from "../../../core/manifest.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { fetchScript, fetchScriptHostnames, logLiveHostnames } from "../api.ts";
import { SCRIPT_MANIFEST } from "../constants.ts";

type EdgeScript = components["schemas"]["EdgeScriptModel"];
type EdgeScriptRelease = components["schemas"]["EdgeScriptReleaseModel"];

const COMMAND = "publish <release> [id]";
const DESCRIPTION = "Publish (roll back to) a past Edge Script deployment.";

const ARG_RELEASE = "release";
const ARG_RELEASE_DESCRIPTION =
  "Release ID to publish (see `deployments list`)";
const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";
const ARG_FORCE = "force";
const ARG_FORCE_DESCRIPTION = "Skip the confirmation prompt";

interface PublishArgs {
  [ARG_RELEASE]: number;
  [ARG_ID]?: EdgeScript["Id"];
  [ARG_FORCE]?: boolean;
}

/**
 * Publish a past release as the live deployment — i.e. roll back.
 *
 * `scripts deploy` already uploads and publishes in one step; this command
 * re-publishes an earlier release (by the ID shown in `deployments list`)
 * without touching the current code. Falls back to the linked script ID from
 * the local manifest when no explicit ID is provided.
 *
 * @example
 * ```bash
 * # Roll back the linked script to release 42
 * bunny scripts deployments publish 42
 *
 * # Roll back a specific script
 * bunny scripts deployments publish 42 12345
 *
 * # Skip the confirmation prompt
 * bunny scripts deployments publish 42 --force
 * ```
 */
export const scriptsDeploymentsPublishCommand = defineCommand<PublishArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    [
      "$0 scripts deployments publish 42",
      "Roll back linked script to a release",
    ],
    ["$0 scripts deployments publish 42 12345", "Roll back a specific script"],
    [
      "$0 scripts deployments publish 42 --force",
      "Skip the confirmation prompt",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_RELEASE, {
        type: "number",
        describe: ARG_RELEASE_DESCRIPTION,
        demandOption: true,
      })
      .positional(ARG_ID, {
        type: "number",
        describe: ARG_ID_DESCRIPTION,
      })
      .option(ARG_FORCE, {
        type: "boolean",
        alias: "f",
        describe: ARG_FORCE_DESCRIPTION,
      }),

  handler: async ({
    [ARG_RELEASE]: releaseId,
    [ARG_ID]: rawId,
    [ARG_FORCE]: force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");
    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const client = createComputeClient(options);

    const spin = spinner("Fetching deployments...");
    spin.start();

    const { data } = await client.GET("/compute/script/{id}/releases", {
      params: { path: { id } },
    });

    spin.stop();

    const release = (data?.Items ?? [])
      .filter((r: EdgeScriptRelease) => !r.Deleted)
      .find((r: EdgeScriptRelease) => r.Id === releaseId);

    if (!release) {
      throw new UserError(
        `Release ${releaseId} not found for script ${id}.`,
        "Run `bunny scripts deployments list` to see available releases.",
      );
    }
    if (!release.Uuid) {
      throw new UserError(`Release ${releaseId} cannot be published.`);
    }

    const proceed = await confirm(
      `Publish release ${releaseId} as the live deployment?`,
      { force: force || output === "json" },
    );
    if (!proceed) {
      logger.info("Aborted.");
      return;
    }

    const pubSpin = spinner("Publishing...");
    pubSpin.start();

    await client.POST("/compute/script/{id}/publish/{uuid}", {
      params: { path: { id, uuid: release.Uuid } },
      body: {},
    });

    pubSpin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify({ id, release: releaseId, published: true }, null, 2),
      );
      return;
    }

    logger.success(`Release ${releaseId} published.`);

    const script = await fetchScript(client, id);
    const coreClient = createCoreClient(options);
    const hostnames = await fetchScriptHostnames(coreClient, script, verbose);
    logLiveHostnames(script, hostnames);
  },
});
