import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createComputeClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { loadManifest } from "../../../core/manifest.ts";
import { spinner } from "../../../core/ui.ts";
import { publishScript, uploadCode } from "./api.ts";
import {
  DEFAULT_ENTRY,
  DNS_SCRIPT_MANIFEST,
  type DnsScriptManifest,
} from "./constants.ts";
import { resolveDnsScriptId } from "./interactive.ts";

const COMMAND = "save [file] [id]";
const DESCRIPTION = "Upload DNS script code (without publishing).";

const ARG_FILE = "file";
const ARG_FILE_DESCRIPTION =
  "Path to the script file (defaults to the entry file)";
const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "DNS script ID (uses the linked script if omitted)";
const ARG_PUBLISH = "publish";
const ARG_PUBLISH_DESCRIPTION = "Publish the uploaded code as the live release";

interface SaveArgs {
  [ARG_FILE]?: string;
  [ARG_ID]?: number;
  [ARG_PUBLISH]?: boolean;
}

/**
 * Upload DNS script code, creating an unpublished deployment.
 *
 * The file is uploaded as-is: DNS scripts are a single `handleQuery`
 * source file, so there is no build step. Pass `--publish` to promote
 * the upload to the live release in one step, or run
 * `bunny dns scripts publish` afterwards.
 *
 * @example
 * ```bash
 * # Save the entry file from the linked script's directory
 * bunny dns scripts save
 *
 * # Save and publish a specific file to a specific script
 * bunny dns scripts save handleQuery.js 12345 --publish
 * ```
 */
export const dnsScriptsSaveCommand = defineCommand<SaveArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 dns scripts save", "Upload the entry file"],
    ["$0 dns scripts save --publish", "Upload and publish"],
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
      .option(ARG_PUBLISH, {
        type: "boolean",
        describe: ARG_PUBLISH_DESCRIPTION,
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const isInteractive = output !== "json" && process.stdout.isTTY;

    const manifest = loadManifest<DnsScriptManifest>(DNS_SCRIPT_MANIFEST);
    const file = args[ARG_FILE] ?? manifest.entry ?? DEFAULT_ENTRY;
    const absPath = resolve(file);
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
      "save to",
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

    const published = args[ARG_PUBLISH] === true;
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
      logger.dim("  Publish:  bunny dns scripts publish");
    }
  },
});
