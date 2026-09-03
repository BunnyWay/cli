import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import {
  fetchScriptHostnames,
  findRelease,
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
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm, spinner } from "@/core/ui.ts";

const COMMAND = "publish <release> [id]";
const DESCRIPTION = "Publish (roll back to) a past Edge Script deployment.";

const ARG_RELEASE = "release";
const ARG_RELEASE_DESCRIPTION =
  "Release ID to publish (see `deployments list`)";
const ARG_FORCE = "force";
const ARG_FORCE_DESCRIPTION = "Skip the confirmation prompt";

interface PublishArgs extends ScriptSelectorArgs {
  [ARG_RELEASE]: number;
  [ARG_FORCE]?: boolean;
}

/**
 * Publish a past release as the live deployment — i.e. roll back.
 *
 * `scripts deploy` already uploads and publishes in one step; this command
 * re-publishes an earlier release (by the ID shown in `deployments list`)
 * without touching the current code. When no ID is given it falls back to the
 * linked script from the local manifest, then to an interactive picker
 * (offering to link the directory for next time).
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
    scriptSelectorBuilder(
      yargs.positional(ARG_RELEASE, {
        type: "number",
        describe: ARG_RELEASE_DESCRIPTION,
        demandOption: true,
      }),
    ).option(ARG_FORCE, {
      type: "boolean",
      alias: "f",
      describe: ARG_FORCE_DESCRIPTION,
    }),

  handler: async ({
    [ARG_RELEASE]: releaseId,
    id: rawId,
    [ARG_FORCE]: force,
    link,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
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

    const release = await findRelease(client, id, releaseId);

    spin.stop();

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
      { force },
    );
    if (!proceed) {
      logger.log("Cancelled.");
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
        JSON.stringify(
          { id, release: releaseId, uuid: release.Uuid, published: true },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Release ${releaseId} published.`);

    const coreClient = createCoreClient(options);
    const hostnames = await fetchScriptHostnames(coreClient, script, verbose);
    logLiveHostnames(script, hostnames);

    await offerLink();
  },
});
