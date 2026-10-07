import type { ToolContext } from "@bunny.net/tools";
import {
  type ReferrerChanges,
  type SecurityChanges,
  type SecurityUpdateResult,
  streamSecurityGet,
  streamSecurityUpdate,
} from "@bunny.net/tools/stream";
import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import { resolveLibraryRef } from "../library-ref.ts";

interface SecurityUpdateArgs {
  library?: string;
  directPlay?: boolean;
  blockDirectAccess?: boolean;
  embedToken?: boolean;
  cdnToken?: boolean;
  tokenIp?: boolean;
  drmBasic?: boolean;
  allowReferrer?: string[];
  removeAllowedReferrer?: string[];
  blockReferrer?: string[];
  removeBlockedReferrer?: string[];
}

const FLAG_HINT =
  "Pass at least one of --direct-play, --block-direct-access, --embed-token, --cdn-token, --token-ip, --drm-basic (or their --no- forms), --allow-referrer, --remove-allowed-referrer, --block-referrer, --remove-blocked-referrer.";

export function securityChangesFromFlags(args: SecurityUpdateArgs): {
  settings: SecurityChanges;
  referrers: ReferrerChanges;
} {
  const settings: SecurityChanges = {};
  for (const key of [
    "directPlay",
    "blockDirectAccess",
    "embedToken",
    "cdnToken",
    "tokenIp",
    "drmBasic",
  ] as const) {
    if (args[key] !== undefined) settings[key] = args[key];
  }
  const list = (values?: string[]) =>
    values
      ?.flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean);
  const referrers: ReferrerChanges = {};
  const allow = list(args.allowReferrer);
  const removeAllowed = list(args.removeAllowedReferrer);
  const block = list(args.blockReferrer);
  const removeBlocked = list(args.removeBlockedReferrer);
  if (allow?.length) referrers.allow = allow;
  if (removeAllowed?.length) referrers.removeAllowed = removeAllowed;
  if (block?.length) referrers.block = block;
  if (removeBlocked?.length) referrers.removeBlocked = removeBlocked;
  return { settings, referrers };
}

/** Prefilled toggles for the on/off settings; unchanged answers are dropped. */
async function promptSecurityChanges(
  ctx: ToolContext,
  library: number,
): Promise<SecurityChanges> {
  const current = await withSpinner("Fetching security settings...", () =>
    streamSecurityGet.invoke(ctx, { library }),
  );
  const toggle = (name: string, message: string, initial: boolean) => ({
    type: "toggle" as const,
    name,
    message,
    initial,
    active: "on",
    inactive: "off",
  });
  let cancelled = false;
  const answers = await prompts(
    [
      toggle("directPlay", "Direct play?", current.directPlay),
      toggle(
        "blockDirectAccess",
        "Block direct url file access?",
        current.blockDirectAccess,
      ),
      toggle(
        "embedToken",
        "Embed view token authentication?",
        current.embedToken,
      ),
      toggle(
        "cdnToken",
        "CDN token authentication?",
        current.cdnToken ?? false,
      ),
    ],
    {
      onCancel: () => {
        cancelled = true;
        return false;
      },
    },
  );
  if (cancelled) throw new UserError("Update cancelled.");
  const changes: SecurityChanges = {};
  for (const key of [
    "directPlay",
    "blockDirectAccess",
    "embedToken",
    "cdnToken",
  ] as const) {
    const before = current[key] ?? false;
    if (answers[key] !== undefined && answers[key] !== before)
      changes[key] = answers[key];
  }
  return changes;
}

function reportResult(result: SecurityUpdateResult): void {
  for (const change of result.changes) {
    if (change.status === "applied")
      logger.success(`Applied: ${change.change}.`);
    else if (change.status === "skipped")
      logger.dim(`Skipped (already in place): ${change.change}.`);
    else if (change.status === "failed")
      logger.error(
        `Failed: ${change.change} (${change.error ?? "unknown error"}).`,
      );
    else logger.warn(`Not attempted: ${change.change}.`);
  }
}

export const streamLibrarySecurityUpdateCommand =
  defineCommand<SecurityUpdateArgs>({
    command: "update [library]",
    describe:
      "Update a video library's security settings and allowed/blocked domains.",
    examples: [
      [
        "$0 stream library security update my-library --embed-token --block-direct-access --allow-referrer example.com",
        "Require embed tokens and lock embeds to one domain",
      ],
      [
        "$0 stream library security update my-library --drm-basic",
        "Turn on MediaCage Basic DRM",
      ],
      ["$0 stream library security update my-library", "Edit interactively"],
    ],

    builder: (yargs) =>
      yargs
        .positional("library", {
          type: "string",
          describe: "Video library name or ID",
        })
        .option("direct-play", {
          type: "boolean",
          describe: "Allow playback from the direct video URL",
        })
        .option("allow-referrer", {
          type: "string",
          array: true,
          describe:
            "Add an allowed domain (repeatable; wildcards like *.example.com)",
        })
        .option("remove-allowed-referrer", {
          type: "string",
          array: true,
          describe: "Remove an allowed domain (repeatable)",
        })
        .option("block-referrer", {
          type: "string",
          array: true,
          describe: "Add a blocked domain (repeatable)",
        })
        .option("remove-blocked-referrer", {
          type: "string",
          array: true,
          describe: "Remove a blocked domain (repeatable)",
        })
        .option("block-direct-access", {
          type: "boolean",
          describe: "Block requests with no Referer header",
        })
        .option("embed-token", {
          type: "boolean",
          describe: "Require embed view token authentication",
        })
        .option("cdn-token", {
          type: "boolean",
          describe: "Require CDN token authentication",
        })
        .option("token-ip", {
          type: "boolean",
          describe: "Bind CDN tokens to the viewer's IP",
        })
        .option("drm-basic", {
          type: "boolean",
          describe:
            "MediaCage Basic DRM on/off (Enterprise DRM libraries are refused)",
        }),

    handler: async (args) => {
      const { library, profile, output, verbose, apiKey } = args;
      const fromFlags = securityChangesFromFlags(args);
      const hasFlags =
        Object.keys(fromFlags.settings).length > 0 ||
        Object.keys(fromFlags.referrers).length > 0;
      if (!hasFlags && !isInteractive(output)) {
        throw new UserError("No changes requested.", FLAG_HINT);
      }

      const config = resolveConfig(profile, apiKey, verbose);
      const ctx = toolContext(config, { verbose });
      const lib = await resolveLibraryRef(ctx, library, {
        output,
        offerLink: true,
      });

      const input = hasFlags
        ? fromFlags
        : { settings: await promptSecurityChanges(ctx, lib.id), referrers: {} };
      if (Object.keys(input.settings).length === 0 && !hasFlags) {
        logger.log("No changes requested.");
        return;
      }

      const result = await withSpinner("Updating security settings...", () =>
        streamSecurityUpdate.invoke(ctx, { library: lib.id, ...input }),
      );

      if (output === "json") {
        logger.log(JSON.stringify(result, null, 2));
      } else {
        reportResult(result);
      }

      if (!result.complete) {
        throw new UserError(
          `Some security changes for ${lib.name} did not land.`,
          "Fix the failed change and re-run the same command; changes already in place are skipped.",
        );
      }
    },
  });
