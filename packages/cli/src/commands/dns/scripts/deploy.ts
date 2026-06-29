import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createComputeClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { loadManifest, manifestRoot } from "../../../core/manifest.ts";
import { spinner } from "../../../core/ui.ts";
import { publishScript, uploadCode } from "./api.ts";
import {
  DEFAULT_ENTRY,
  DNS_SCRIPT_MANIFEST,
  type DnsScriptManifest,
} from "./constants.ts";
import { resolveDnsScriptId } from "./interactive.ts";

const COMMAND = "deploy [file] [id]";
const DESCRIPTION = "Upload DNS script code and publish it.";

const ARG_FILE = "file";
const ARG_FILE_DESCRIPTION =
  "Path to the script file (defaults to the entry file)";
const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "DNS script ID (uses the linked script if omitted)";
const ARG_SKIP_PUBLISH = "skip-publish";
const ARG_SKIP_PUBLISH_DESCRIPTION = "Upload code without publishing";

interface DeployArgs {
  [ARG_FILE]?: string;
  [ARG_ID]?: number;
  [ARG_SKIP_PUBLISH]?: boolean;
}

/**
 * Upload DNS script code and publish it as the live release.
 *
 * The file is uploaded as-is: DNS scripts are a single `handleQuery`
 * source file, so there is no build step. Publishes by default; pass
 * `--skip-publish` to stage the upload without making it live.
 *
 * @example
 * ```bash
 * # Deploy the entry file from the linked script's directory
 * bunny dns scripts deploy
 *
 * # Stage a specific file without publishing
 * bunny dns scripts deploy handleQuery.js 12345 --skip-publish
 * ```
 */
export const dnsScriptsDeployCommand = defineCommand<DeployArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 dns scripts deploy", "Upload and publish the entry file"],
    ["$0 dns scripts deploy --skip-publish", "Stage without publishing"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_FILE, {
        type: "string",
        describe: ARG_FILE_DESCRIPTION,
      })
      .positional(ARG_ID, {
        type: "number",
        describe: ARG_ID_DESCRIPTION,
      })
      .option(ARG_SKIP_PUBLISH, {
        type: "boolean",
        describe: ARG_SKIP_PUBLISH_DESCRIPTION,
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const isInteractive = output !== "json" && process.stdout.isTTY;

    const manifest = loadManifest<DnsScriptManifest>(DNS_SCRIPT_MANIFEST);
    const defaultFile = manifest.entry ?? DEFAULT_ENTRY;
    let file = args[ARG_FILE];
    if (file === undefined && isInteractive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "File to upload:",
        initial: defaultFile,
      });
      file = value;
    }
    file ??= defaultFile;
    // The manifest entry is relative to the linked project root; an explicit path stays relative to the cwd.
    const absPath =
      file === defaultFile
        ? resolve(manifestRoot(DNS_SCRIPT_MANIFEST), file)
        : resolve(file);
    if (!existsSync(absPath)) {
      throw new UserError(
        `File not found: ${file}`,
        "Pass a file path, or run from a directory created by `bunny dns scripts init`.",
      );
    }
    const code = await Bun.file(absPath).text();

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const id = await resolveDnsScriptId(
      client,
      args[ARG_ID],
      "deploy to",
      isInteractive,
    );

    const spin = spinner("Uploading code...");
    spin.start();
    try {
      await uploadCode(client, id, code);
    } finally {
      spin.stop();
    }
    logger.success("Code uploaded.");

    const published = args[ARG_SKIP_PUBLISH] !== true;
    if (published) {
      const pubSpin = spinner("Publishing...");
      pubSpin.start();
      try {
        await publishScript(client, id);
      } finally {
        pubSpin.stop();
      }
      logger.success("Deployment published.");
    }

    if (output === "json") {
      logger.log(JSON.stringify({ id, file, published }, null, 2));
      return;
    }

    if (!published) {
      logger.log();
      logger.dim("  Publish later: bunny dns scripts deploy");
    }
  },
});
