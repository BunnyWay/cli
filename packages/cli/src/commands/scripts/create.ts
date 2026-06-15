import { basename, resolve } from "node:path";
import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatKeyValue } from "../../core/format.ts";
import {
  addHostname,
  normalizeHostname,
  offerBunnyDnsThenSsl,
  offerDnsWaitAndSsl,
  printSslHint,
} from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, saveManifest } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { promptOpenInBrowser } from "./api.ts";
import {
  type EdgeScriptTypes,
  parseScriptType,
  SCRIPT_MANIFEST,
  SCRIPT_TYPE_MIDDLEWARE,
  SCRIPT_TYPE_STANDALONE,
  scriptTypeLabel,
} from "./constants.ts";

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
const ARG_DOMAIN = "domain";
const ARG_DOMAIN_DESCRIPTION =
  "Add a custom domain to the new script's pull zone (prompted when interactive)";

interface CreateArgs {
  [ARG_NAME]?: string;
  [ARG_TYPE]?: string;
  [ARG_PULL_ZONE]?: boolean;
  [ARG_PULL_ZONE_NAME]?: string;
  [ARG_LINK]?: boolean;
  [ARG_DOMAIN]?: string;
}

interface CreatedScript {
  id: number;
  name: string;
  scriptType: EdgeScriptTypes;
  hostname?: string;
  pullZoneId?: number;
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
  const config = resolveConfig(opts.profile, opts.apiKey, opts.verbose);
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
    pullZoneId: script.LinkedPullZones?.[0]?.Id ?? undefined,
  };
}

/**
 * Attach a custom domain to the new script's pull zone, print the DNS
 * instructions, and (when interactive) offer to wait for DNS and enable
 * HTTPS. A failure to add the domain is a warning, not an error — the
 * script itself was already created.
 *
 * Shared between `scripts create` and `scripts init`. Returns true when
 * an SSL certificate was issued for the domain.
 */
export async function setupCustomDomain(opts: {
  profile: string;
  apiKey?: string;
  verbose: boolean;
  pullZoneId: number;
  domain: string;
  scriptId: number;
  linked: boolean;
  interactive: boolean;
}): Promise<boolean> {
  const config = resolveConfig(opts.profile, opts.apiKey, opts.verbose);
  const coreClient = createCoreClient(clientOptions(config, opts.verbose));
  const idSuffix = opts.linked ? "" : ` --id ${opts.scriptId}`;
  const sslHint = `bunny scripts domains ssl ${opts.domain}${idSuffix}`;

  const spin = spinner(`Adding ${opts.domain}...`);
  spin.start();

  let cnameTarget: string | undefined;
  try {
    ({ cnameTarget } = await addHostname(
      coreClient,
      opts.pullZoneId,
      opts.domain,
    ));
  } catch (err) {
    spin.stop();
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Couldn't add ${opts.domain}: ${message}`);
    logger.dim(`  Retry: bunny scripts domains add ${opts.domain}${idSuffix}`);
    return false;
  }

  spin.stop();
  logger.success(`Added ${opts.domain} to pull zone ${opts.pullZoneId}.`);

  if (!cnameTarget) return false;

  // If the domain is on Bunny DNS, offer to add the record (prompted) so SSL can issue right away.
  if (opts.interactive) {
    const issued = await offerBunnyDnsThenSsl({
      coreClient,
      hostname: opts.domain,
      pullZoneId: opts.pullZoneId,
      cnameTarget,
      forceSsl: true,
      sslHint,
      verbose: opts.verbose,
    });
    if (issued !== null) return issued;
  }

  logger.log();
  logger.log("Point your DNS at bunny.net to activate it:");
  logger.accent(`  CNAME  ${opts.domain}  →  ${cnameTarget}`);
  logger.log();

  if (!opts.interactive) {
    printSslHint(sslHint);
    return false;
  }

  return offerDnsWaitAndSsl({
    coreClient,
    pullZoneId: opts.pullZoneId,
    hostname: opts.domain,
    cnameTarget,
    forceSsl: true,
    sslHint,
  });
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
    [
      "$0 scripts create my-script --domain shop.example.com",
      "Create and attach a custom domain",
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
      })
      .option(ARG_DOMAIN, {
        type: "string",
        describe: ARG_DOMAIN_DESCRIPTION,
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const isInteractive = output !== "json" && process.stdout.isTTY;

    const name = args[ARG_NAME] ?? basename(resolve(process.cwd()));
    if (!name) throw new UserError("Script name is required.");

    const domainFlag = args[ARG_DOMAIN]
      ? normalizeHostname(args[ARG_DOMAIN])
      : undefined;
    if (domainFlag && args[ARG_PULL_ZONE] === false) {
      throw new UserError(
        "--domain requires a linked pull zone.",
        "Drop --no-pull-zone to attach a custom domain.",
      );
    }

    const manifest = loadManifest(SCRIPT_MANIFEST);

    // Resolve script type: explicit flag → manifest → prompt → error.
    let scriptType = parseScriptType(args[ARG_TYPE]);
    if (scriptType === undefined) {
      if (
        manifest.scriptType === SCRIPT_TYPE_STANDALONE ||
        manifest.scriptType === SCRIPT_TYPE_MIDDLEWARE
      ) {
        scriptType = manifest.scriptType;
      } else if (isInteractive) {
        const { value } = await prompts({
          type: "select",
          name: "value",
          message: "Script type:",
          choices: [
            {
              title: "Standalone — handles requests independently",
              value: SCRIPT_TYPE_STANDALONE,
            },
            {
              title: "Middleware — processes requests before/after origin",
              value: SCRIPT_TYPE_MIDDLEWARE,
            },
          ],
        });
        scriptType = value;
      }
    }
    if (
      scriptType !== SCRIPT_TYPE_STANDALONE &&
      scriptType !== SCRIPT_TYPE_MIDDLEWARE
    ) {
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
    const linkArg = args[ARG_LINK];
    let shouldLink: boolean;
    if (linkArg !== undefined) {
      shouldLink = linkArg;
    } else if (isInteractive && manifest.id && manifest.id !== created.id) {
      shouldLink = await confirm(
        `Replace existing link to ${manifest.name ?? manifest.id}?`,
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
      // --domain is added non-interactively; a failure still reports the created script.
      let customDomain: {
        hostname: string;
        cnameTarget: string | null;
      } | null = null;
      let customDomainError: string | undefined;
      if (domainFlag && created.pullZoneId != null) {
        const config = resolveConfig(profile, apiKey, verbose);
        const coreClient = createCoreClient(clientOptions(config, verbose));
        try {
          const { cnameTarget } = await addHostname(
            coreClient,
            created.pullZoneId,
            domainFlag,
          );
          customDomain = {
            hostname: domainFlag,
            cnameTarget: cnameTarget ?? null,
          };
        } catch (err) {
          customDomainError = err instanceof Error ? err.message : String(err);
        }
      }

      logger.log(
        JSON.stringify(
          {
            id: created.id,
            name: created.name,
            scriptType: created.scriptType,
            hostname: created.hostname ?? null,
            linked: shouldLink,
            customDomain,
            ...(customDomainError ? { customDomainError } : {}),
          },
          null,
          2,
        ),
      );
      if (customDomainError) process.exit(1);
      return;
    }

    const entries: Array<{ key: string; value: string }> = [
      { key: "ID", value: String(created.id) },
      { key: "Name", value: created.name },
      {
        key: "Type",
        value: scriptTypeLabel(created.scriptType),
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

    // Custom domain: --domain flag, or offer one interactively when a pull zone exists.
    let openTarget = created.hostname;
    if (created.pullZoneId != null) {
      let domain = domainFlag;
      if (!domain && isInteractive) {
        const { value } = await prompts({
          type: "text",
          name: "value",
          message: "Custom domain (leave blank to skip):",
        });
        domain = normalizeHostname(value ?? "");
      }

      if (domain) {
        const sslIssued = await setupCustomDomain({
          profile,
          apiKey,
          verbose,
          pullZoneId: created.pullZoneId,
          domain,
          scriptId: created.id,
          linked: shouldLink,
          interactive: isInteractive,
        });
        if (sslIssued) openTarget = domain;
        logger.log();
      }
    } else if (domainFlag) {
      logger.warn("No linked pull zone — can't attach a custom domain.");
    }

    if (openTarget && isInteractive) {
      await promptOpenInBrowser(openTarget);
    } else {
      logger.dim(`  Deploy:  bunny scripts deploy <file>`);
    }
  },
});
