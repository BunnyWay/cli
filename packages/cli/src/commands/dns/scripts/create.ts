import { basename, resolve } from "node:path";
import { createComputeClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, saveManifest } from "@/core/manifest.ts";
import { confirm, isInteractive, prompts, spinner } from "@/core/ui.ts";
import { createDnsScript } from "./api.ts";
import {
  DNS_SCRIPT_MANIFEST,
  type DnsScriptManifest,
  SCRIPT_TYPE_DNS,
} from "./constants.ts";

const COMMAND = "create [name]";
const DESCRIPTION = "Create a Scriptable DNS script on bunny.net.";

const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Script name (defaults to current directory name)";
const ARG_LINK = "link";
const ARG_LINK_DESCRIPTION =
  "Link this directory to the new script (default: true). Use --no-link to skip.";

interface CreateArgs {
  [ARG_NAME]?: string;
  [ARG_LINK]?: boolean;
}

/**
 * Create a Scriptable DNS script on bunny.net (without scaffolding files).
 *
 * Unlike Edge Scripts, DNS scripts have no linked pull zone: they are
 * attached to a zone later with `bunny dns scripts connect`.
 *
 * @example
 * ```bash
 * # Create using the current directory name
 * bunny dns scripts create
 *
 * # Explicit name, without linking the directory
 * bunny dns scripts create geo-router --no-link
 * ```
 */
export const dnsScriptsCreateCommand = defineCommand<CreateArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 dns scripts create", "Create using current directory name"],
    ["$0 dns scripts create geo-router", "Create with an explicit name"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_NAME, {
        type: "string",
        describe: ARG_NAME_DESCRIPTION,
      })
      .option(ARG_LINK, {
        type: "boolean",
        describe: ARG_LINK_DESCRIPTION,
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const interactive = isInteractive(output);

    const dirName = basename(resolve(process.cwd()));
    let name = args[ARG_NAME];
    if (!name && interactive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Script name:",
        initial: dirName,
      });
      name = value;
    }
    name ??= dirName;
    if (!name) throw new UserError("Script name is required.");

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner(`Creating DNS script "${name}"...`);
    spin.start();
    let created: { id: number; name: string };
    try {
      created = await createDnsScript(client, name);
    } finally {
      spin.stop();
    }

    const manifest = loadManifest<DnsScriptManifest>(DNS_SCRIPT_MANIFEST);
    const linkArg = args[ARG_LINK];
    let shouldLink: boolean;
    if (linkArg !== undefined) {
      shouldLink = linkArg;
    } else if (interactive && manifest.id && manifest.id !== created.id) {
      shouldLink = await confirm(
        `Replace existing link to ${manifest.name ?? manifest.id}?`,
        { optional: true },
      );
    } else {
      shouldLink = true;
    }

    if (shouldLink) {
      saveManifest<DnsScriptManifest>(DNS_SCRIPT_MANIFEST, {
        ...manifest,
        id: created.id,
        name: created.name,
        scriptType: SCRIPT_TYPE_DNS,
      });
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { id: created.id, name: created.name, linked: shouldLink },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Created DNS script "${created.name}" (${created.id}).`);
    logger.log();
    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: String(created.id) },
          { key: "Name", value: created.name },
        ],
        output,
      ),
    );

    if (shouldLink) {
      logger.log();
      logger.success(`Linked .bunny/${DNS_SCRIPT_MANIFEST} -> ${created.id}.`);
    }

    logger.log();
    logger.dim("  Deploy:  bunny dns scripts deploy");
    logger.dim("  Attach:  bunny dns scripts attach");
  },
});
