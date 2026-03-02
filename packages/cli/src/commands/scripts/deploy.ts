import { existsSync } from "fs";
import { resolve } from "path";
import { createComputeClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { resolveManifestId } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { SCRIPT_MANIFEST } from "./constants.ts";
import { clientOptions } from "../../core/client-options.ts";

const COMMAND = "deploy <file> [id]";
const DESCRIPTION = "Deploy code to an Edge Script.";

const ARG_FILE = "file";
const ARG_FILE_DESCRIPTION = "Path to the built file to deploy";
const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";
const ARG_PUBLISH = "publish";
const ARG_PUBLISH_ALIAS = "p";
const ARG_PUBLISH_DESCRIPTION = "Publish the deployment immediately";

interface DeployArgs {
  [ARG_FILE]: string;
  [ARG_ID]?: number;
  [ARG_PUBLISH]?: boolean;
}

/**
 * Deploy code to an Edge Script.
 *
 * Reads the specified file and uploads it as the script code. Optionally
 * publishes the deployment as a live release. When neither `--publish`
 * nor `--no-publish` is passed, prompts interactively.
 *
 * @example
 * ```bash
 * # Deploy and prompt to publish
 * bunny scripts deploy dist/index.js
 *
 * # Deploy and publish immediately
 * bunny scripts deploy dist/index.js --publish
 *
 * # Deploy without publishing
 * bunny scripts deploy dist/index.js --no-publish
 *
 * # Deploy to a specific script
 * bunny scripts deploy dist/index.js 12345
 * ```
 */
export const scriptsDeployCommand = defineCommand<DeployArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional(ARG_FILE, {
        type: "string",
        describe: ARG_FILE_DESCRIPTION,
        demandOption: true,
      })
      .positional(ARG_ID, {
        type: "number",
        describe: ARG_ID_DESCRIPTION,
      })
      .option(ARG_PUBLISH, {
        alias: ARG_PUBLISH_ALIAS,
        type: "boolean",
        describe: ARG_PUBLISH_DESCRIPTION,
      }),

  handler: async ({
    [ARG_FILE]: file,
    [ARG_ID]: rawId,
    [ARG_PUBLISH]: publish,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");

    const absPath = resolve(file);
    if (!existsSync(absPath)) {
      throw new UserError(`File not found: ${file}`);
    }

    const code = await Bun.file(absPath).text();

    const config = resolveConfig(profile, apiKey);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Uploading code...");
    spin.start();

    await client.POST("/compute/script/{id}/code", {
      params: { path: { id } },
      body: { Code: code },
    });

    spin.stop();
    logger.success("Code uploaded.");

    let published = false;

    if (publish === true) {
      published = true;
    } else if (publish === undefined) {
      published = await confirm("Publish this deployment?");
    }

    if (published) {
      const pubSpin = spinner("Publishing...");
      pubSpin.start();

      await client.POST("/compute/script/{id}/publish", {
        params: { path: { id, uuid: null } },
        body: {},
      });

      pubSpin.stop();
      logger.success("Deployment published.");
    }

    if (output === "json") {
      logger.log(JSON.stringify({ id, file, published }, null, 2));
      return;
    }

    const { data: script } = await client.GET("/compute/script/{id}", {
      params: { path: { id } },
    });

    const hostname =
      script?.LinkedPullZones?.[0]?.DefaultHostname ?? undefined;
    if (hostname && published) {
      logger.info(`Live at: ${hostname}`);
    }
  },
});
