import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { resolveManifestId } from "@/core/manifest.ts";
import { spinner } from "@/core/ui.ts";
import {
  fetchScript,
  fetchScriptHostnames,
  logLiveHostnames,
  publishScript,
  uploadScriptCode,
} from "./api.ts";
import { assertScriptSize, bundleEdgeScript } from "./bundle.ts";
import { SCRIPT_MANIFEST } from "./constants.ts";

const COMMAND = "deploy <file> [id]";
const DESCRIPTION = "Deploy code to an Edge Script.";

const ARG_FILE = "file";
const ARG_FILE_DESCRIPTION = "Path to the built file to deploy";
const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";
const ARG_SKIP_PUBLISH = "skip-publish";
const ARG_SKIP_PUBLISH_DESCRIPTION = "Upload code without publishing";
const ARG_BUNDLE = "bundle";
const ARG_BUNDLE_DESCRIPTION =
  "Bundle the entry and its dependencies for the edge runtime before uploading";

interface DeployArgs {
  [ARG_FILE]: string;
  [ARG_ID]?: number;
  [ARG_SKIP_PUBLISH]?: boolean;
  [ARG_BUNDLE]?: boolean;
}

/**
 * Deploy code to an Edge Script.
 *
 * Reads the specified file and uploads it as the script code. Publishes
 * the deployment as a live release by default. Use `--skip-publish` to
 * upload code without publishing. Use `--bundle` to bundle a source
 * entry (TypeScript, local imports, npm dependencies) first.
 *
 * @example
 * ```bash
 * # Deploy and publish
 * bunny scripts deploy dist/index.js
 *
 * # Deploy without publishing
 * bunny scripts deploy dist/index.js --skip-publish
 *
 * # Bundle a TypeScript entry, then deploy
 * bunny scripts deploy src/index.ts --bundle
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
    [
      "$0 scripts deploy src/index.ts --bundle",
      "Bundle a TypeScript entry, then deploy",
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
      })
      .option(ARG_BUNDLE, {
        type: "boolean",
        describe: ARG_BUNDLE_DESCRIPTION,
      }),

  handler: async ({
    [ARG_FILE]: file,
    [ARG_ID]: rawId,
    [ARG_SKIP_PUBLISH]: skipPublish,
    [ARG_BUNDLE]: bundle,
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

    let code: string;
    if (bundle) {
      const bundled = await bundleEdgeScript({ entry: absPath, label: file });
      for (const warning of bundled.warnings) logger.warn(warning);
      code = bundled.code;
    } else {
      code = await Bun.file(absPath).text();
      assertScriptSize(code, file);
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const client = createComputeClient(options);

    const spin = spinner("Uploading code...");
    spin.start();

    await uploadScriptCode(client, id, code);

    spin.stop();
    logger.success("Code uploaded.");

    const published = !skipPublish;

    if (published) {
      const pubSpin = spinner("Publishing...");
      pubSpin.start();

      await publishScript(client, id);

      pubSpin.stop();
      logger.success("Deployment published.");
    }

    if (output === "json") {
      logger.log(JSON.stringify({ id, file, published }, null, 2));
      return;
    }

    if (!published) return;

    const script = await fetchScript(client, id);
    const coreClient = createCoreClient(options);
    const hostnames = await fetchScriptHostnames(coreClient, script, verbose);
    logLiveHostnames(script, hostnames);
  },
});
