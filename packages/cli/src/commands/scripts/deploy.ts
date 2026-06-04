import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import {
  fetchPullZoneHostnames,
  type Hostname,
  hostnameUrl,
} from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { resolveManifestId } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import { SCRIPT_MANIFEST } from "./constants.ts";

const COMMAND = "deploy <file> [id]";
const DESCRIPTION = "Deploy code to an Edge Script.";

const ARG_FILE = "file";
const ARG_FILE_DESCRIPTION = "Path to the built file to deploy";
const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";
const ARG_SKIP_PUBLISH = "skip-publish";
const ARG_SKIP_PUBLISH_DESCRIPTION = "Upload code without publishing";

interface DeployArgs {
  [ARG_FILE]: string;
  [ARG_ID]?: number;
  [ARG_SKIP_PUBLISH]?: boolean;
}

/**
 * Deploy code to an Edge Script.
 *
 * Reads the specified file and uploads it as the script code. Publishes
 * the deployment as a live release by default. Use `--skip-publish` to
 * upload code without publishing.
 *
 * @example
 * ```bash
 * # Deploy and publish
 * bunny scripts deploy dist/index.js
 *
 * # Deploy without publishing
 * bunny scripts deploy dist/index.js --skip-publish
 *
 * # Deploy to a specific script
 * bunny scripts deploy dist/index.js 12345
 * ```
 */
export const scriptsDeployCommand = defineCommand<DeployArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts deploy dist/index.js", "Deploy and publish"],
    [
      "$0 scripts deploy dist/index.js --skip-publish",
      "Deploy without publishing",
    ],
    ["$0 scripts deploy dist/index.js 12345", "Deploy to a specific script"],
  ],

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
      .option(ARG_SKIP_PUBLISH, {
        type: "boolean",
        describe: ARG_SKIP_PUBLISH_DESCRIPTION,
      }),

  handler: async ({
    [ARG_FILE]: file,
    [ARG_ID]: rawId,
    [ARG_SKIP_PUBLISH]: skipPublish,
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

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const client = createComputeClient(options);

    const spin = spinner("Uploading code...");
    spin.start();

    await client.POST("/compute/script/{id}/code", {
      params: { path: { id } },
      body: { Code: code },
    });

    spin.stop();
    logger.success("Code uploaded.");

    const published = !skipPublish;

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

    if (!published) return;

    const { data: script } = await client.GET("/compute/script/{id}", {
      params: { path: { id } },
    });

    const zones = script?.LinkedPullZones ?? [];

    // Pull the full hostname list (incl. custom domains) from the core API;
    // fall back to the script's system hostname if that lookup fails.
    const coreClient = createCoreClient(options);
    const hostnames: Hostname[] = [];
    for (const zone of zones) {
      if (zone.Id == null) continue;
      try {
        hostnames.push(...(await fetchPullZoneHostnames(coreClient, zone.Id)));
      } catch {}
    }

    if (hostnames.length === 0) {
      const fallback = zones[0]?.DefaultHostname;
      if (fallback) logger.info(`Live at: ${fallback}`);
      return;
    }

    const system = hostnames.find((h) => h.IsSystemHostname);
    const primary = system ?? hostnames[0];
    const customs = hostnames.filter((h) => h !== primary);

    if (primary?.Value) {
      logger.info(
        `Live at: ${hostnameUrl(primary.Value, {
          hasCertificate: primary.HasCertificate,
          forceSSL: primary.ForceSSL,
        })}`,
      );
    }

    for (const custom of customs) {
      if (!custom.Value) continue;
      logger.log(
        `  ${hostnameUrl(custom.Value, {
          hasCertificate: custom.HasCertificate,
          forceSSL: custom.ForceSSL,
        })}`,
      );
    }
  },
});
