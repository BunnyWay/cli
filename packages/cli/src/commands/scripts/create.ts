import { basename, resolve } from "node:path";
import { createComputeClient } from "@bunny.net/api";
import type { components } from "@bunny.net/api/generated/compute.d.ts";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatKeyValue } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, saveManifest } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { SCRIPT_MANIFEST } from "./constants.ts";

type EdgeScriptTypes = components["schemas"]["EdgeScriptTypes"];

const COMMAND = "create [name]";
const DESCRIPTION = "Create a new Edge Script on bunny.net.";

const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Script name (defaults to current directory name)";
const ARG_TYPE = "type";
const ARG_TYPE_DESCRIPTION = "Script type: standalone or middleware";
const ARG_PULL_ZONE = "pull-zone";
const ARG_PULL_ZONE_DESCRIPTION =
  "Create a linked pull zone (default: true). Use --no-pull-zone to skip.";
const ARG_PULL_ZONE_NAME = "pull-zone-name";
const ARG_PULL_ZONE_NAME_DESCRIPTION = "Name for the linked pull zone";
const ARG_LINK = "link";
const ARG_LINK_DESCRIPTION =
  "Link this directory to the new script (default: true). Use --no-link to skip.";

interface CreateArgs {
  [ARG_NAME]?: string;
  [ARG_TYPE]?: string;
  [ARG_PULL_ZONE]?: boolean;
  [ARG_PULL_ZONE_NAME]?: string;
  [ARG_LINK]?: boolean;
}

interface CreatedScript {
  id: number;
  name: string;
  scriptType: EdgeScriptTypes;
  hostname?: string;
}

/**
 * Create the remote Edge Script via the compute API.
 *
 * Shared between `scripts create` and `scripts init`. Returns the
 * created script's id, name, type, and (if a pull zone was created)
 * its default hostname.
 */
export async function createScript(opts: {
  profile: string;
  apiKey?: string;
  verbose: boolean;
  name: string;
  scriptType: EdgeScriptTypes;
  createLinkedPullZone: boolean;
  linkedPullZoneName?: string;
}): Promise<CreatedScript> {
  const config = resolveConfig(opts.profile, opts.apiKey);
  const client = createComputeClient(clientOptions(config, opts.verbose));

  const spin = spinner(`Creating script "${opts.name}"...`);
  spin.start();

  const { data: script } = await client.POST("/compute/script", {
    body: {
      Name: opts.name,
      ScriptType: opts.scriptType,
      CreateLinkedPullZone: opts.createLinkedPullZone,
      ...(opts.linkedPullZoneName
        ? { LinkedPullZoneName: opts.linkedPullZoneName }
        : {}),
    },
  });

  spin.stop();

  if (!script || script.Id == null) {
    throw new UserError("Failed to create Edge Script.");
  }

  return {
    id: script.Id,
    name: script.Name ?? opts.name,
    scriptType: opts.scriptType,
    hostname: script.LinkedPullZones?.[0]?.DefaultHostname ?? undefined,
  };
}

/**
 * Create a new Edge Script on bunny.net (without scaffolding a project).
 *
 * Use this when you already have a project (e.g. you ran `init` without
 * `--deploy`, or you're working in a custom directory) and need a remote
 * script before running `bunny scripts deploy`.
 *
 * By default the script name is the current directory name, a linked
 * pull zone is created, and the directory is linked via
 * `.bunny/script.json`.
 *
 * @example
 * ```bash
 * # Create using current directory name + linked manifest
 * bunny scripts create
 *
 * # Explicit name, middleware type, no pull zone
 * bunny scripts create my-script --type middleware --no-pull-zone
 *
 * # Create without linking (.bunny/script.json untouched)
 * bunny scripts create my-script --no-link
 * ```
 */
export const scriptsCreateCommand = defineCommand<CreateArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts create", "Create using current directory name"],
    [
      "$0 scripts create my-script --type middleware",
      "Create a middleware script with an explicit name",
    ],
    [
      "$0 scripts create my-script --no-pull-zone --no-link",
      "Skip pull zone creation and directory linking",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_NAME, {
        type: "string",
        describe: ARG_NAME_DESCRIPTION,
      })
      .option(ARG_TYPE, {
        type: "string",
        choices: ["standalone", "middleware"],
        describe: ARG_TYPE_DESCRIPTION,
      })
      .option(ARG_PULL_ZONE, {
        type: "boolean",
        describe: ARG_PULL_ZONE_DESCRIPTION,
      })
      .option(ARG_PULL_ZONE_NAME, {
        type: "string",
        describe: ARG_PULL_ZONE_NAME_DESCRIPTION,
      })
      .option(ARG_LINK, {
        type: "boolean",
        describe: ARG_LINK_DESCRIPTION,
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const isInteractive = output !== "json" && process.stdout.isTTY;

    const name = args[ARG_NAME] ?? basename(resolve(process.cwd()));
    if (!name) throw new UserError("Script name is required.");

    // Resolve script type: explicit flag → manifest → prompt → error.
    let scriptType: EdgeScriptTypes | undefined;
    if (args[ARG_TYPE]) {
      scriptType = args[ARG_TYPE] === "standalone" ? 1 : 2;
    } else {
      const manifest = loadManifest(SCRIPT_MANIFEST);
      if (manifest.scriptType === 1 || manifest.scriptType === 2) {
        scriptType = manifest.scriptType as EdgeScriptTypes;
      } else if (isInteractive) {
        const { value } = await prompts({
          type: "select",
          name: "value",
          message: "Script type:",
          choices: [
            { title: "Standalone — handles requests independently", value: 1 },
            {
              title: "Middleware — processes requests before/after origin",
              value: 2,
            },
          ],
        });
        scriptType = value;
      }
    }
    if (scriptType !== 1 && scriptType !== 2) {
      throw new UserError(
        "Script type is required.",
        "Pass --type standalone or --type middleware.",
      );
    }

    const created = await createScript({
      profile,
      apiKey,
      verbose,
      name,
      scriptType,
      createLinkedPullZone: args[ARG_PULL_ZONE] !== false,
      linkedPullZoneName: args[ARG_PULL_ZONE_NAME],
    });

    // Decide whether to link this directory to the new script.
    const existing = loadManifest(SCRIPT_MANIFEST);
    const linkArg = args[ARG_LINK];
    let shouldLink: boolean;
    if (linkArg !== undefined) {
      shouldLink = linkArg;
    } else if (isInteractive && existing.id && existing.id !== created.id) {
      shouldLink = await confirm(
        `Replace existing link to ${existing.name ?? existing.id}?`,
      );
    } else {
      shouldLink = true;
    }

    if (shouldLink) {
      saveManifest(SCRIPT_MANIFEST, {
        id: created.id,
        name: created.name,
        scriptType: created.scriptType,
      });
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            id: created.id,
            name: created.name,
            scriptType: created.scriptType,
            hostname: created.hostname ?? null,
            linked: shouldLink,
          },
          null,
          2,
        ),
      );
      return;
    }

    const entries: Array<{ key: string; value: string }> = [
      { key: "ID", value: String(created.id) },
      { key: "Name", value: created.name },
      {
        key: "Type",
        value: created.scriptType === 1 ? "Standalone" : "Middleware",
      },
    ];
    if (created.hostname) {
      entries.push({ key: "Hostname", value: created.hostname });
    }

    logger.success(`Created script "${created.name}" (${created.id}).`);
    logger.log();
    logger.log(formatKeyValue(entries, output));

    if (shouldLink) {
      logger.log();
      logger.success(`Linked .bunny/script.json → ${created.id}.`);
    }

    logger.log();
    logger.dim(`  Deploy:  bunny scripts deploy <file>`);
  },
});
