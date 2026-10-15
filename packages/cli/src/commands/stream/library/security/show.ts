import {
  streamSecurityGet,
  streamSecurityResetToken,
  streamSecurityTokenKey,
} from "@bunny.net/tools/stream";
import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { maskSecret } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import { formatSecuritySettings } from "./render.ts";

interface SecurityShowArgs {
  library?: string;
  showSecret?: boolean;
  rotate?: boolean;
  force?: boolean;
}

export const streamLibrarySecurityShowCommand = defineCommand<SecurityShowArgs>(
  {
    command: "show [library]",
    describe:
      "Show a video library's security settings, including the token authentication key (masked).",
    examples: [
      [
        "$0 stream libraries security show my-library",
        "Show security settings",
      ],
      [
        "$0 stream libraries security show my-library --show-secret",
        "Also reveal the token authentication key",
      ],
      [
        "$0 stream libraries security show my-library --rotate",
        "Reset the token key, then show the new one (masked)",
      ],
      [
        "$0 stream libraries security show my-library --rotate --force",
        "Reset the token key without asking",
      ],
    ],

    builder: (yargs) =>
      yargs
        .positional("library", {
          type: "string",
          describe: "Video library name or ID",
        })
        .option("show-secret", {
          type: "boolean",
          default: false,
          describe: "Reveal the token authentication key (masked by default)",
        })
        .option("rotate", {
          type: "boolean",
          default: false,
          describe:
            "Reset the token key used for CDN and embed view tokens; every signed URL issued with the old key stops working",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          default: false,
          describe: "Skip the rotation confirmation",
        }),

    handler: async ({
      library,
      showSecret,
      rotate,
      force,
      profile,
      output,
      verbose,
      apiKey,
    }) => {
      if (rotate) {
        requireConfirmable(output, {
          force,
          message: "Resetting the token key needs confirmation.",
          hint: "Pass --force to reset it without a prompt.",
        });
      }

      const config = resolveConfig(profile, apiKey, verbose);
      const ctx = toolContext(config, { verbose });
      const lib = await resolveLibraryRef(ctx, library, {
        output,
        offerLink: !rotate,
        force: rotate ? force : undefined,
      });

      if (rotate) {
        const approved = await confirm(
          `Reset the token key for ${lib.name}? Signed URLs issued with the old key stop working.`,
          { force },
        );
        if (!approved) {
          logger.log("Cancelled.");
          return;
        }
        await withSpinner("Resetting the token key...", () =>
          streamSecurityResetToken.invoke(ctx, { library: lib.id }),
        );
        if (output !== "json") {
          logger.success(
            `Reset the token authentication key for video library ${lib.name}.`,
          );
        }
      }

      const security = await withSpinner("Fetching security settings...", () =>
        streamSecurityGet.invoke(ctx, { library: lib.id }),
      );
      // The key is optional extra: a library without a linked Pull Zone still shows its settings.
      const token = security.pullZoneId
        ? await withSpinner("Fetching the token key...", () =>
            streamSecurityTokenKey.invoke(ctx, { library: lib.id }),
          ).catch(() => undefined)
        : undefined;

      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              ...security,
              rotated: rotate ?? false,
              tokenKey: token
                ? showSecret
                  ? token.key
                  : maskSecret(token.key)
                : null,
            },
            null,
            2,
          ),
        );
        return;
      }

      logger.log(
        formatSecuritySettings(
          security,
          output,
          token ? { key: token.key, reveal: Boolean(showSecret) } : undefined,
        ),
      );
      if (token && showSecret) {
        logger.warn("Treat the token key like a password.");
      } else if (token) {
        logger.dim("Token key masked. Pass --show-secret to reveal it.");
      }
    },
  },
);
