import {
  streamSecurityGet,
  streamSecurityTokenKey,
} from "@bunny.net/tools/stream";
import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { maskSecret } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import { withSpinner } from "@/core/ui.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import { formatSecuritySettings } from "./render.ts";

interface SecurityShowArgs {
  library?: string;
  showSecret?: boolean;
}

export const streamLibrarySecurityShowCommand = defineCommand<SecurityShowArgs>(
  {
    command: "show [library]",
    describe:
      "Show a video library's security settings, including the token authentication key (masked).",
    examples: [
      ["$0 stream library security show my-library", "Show security settings"],
      [
        "$0 stream library security show my-library --show-secret",
        "Also reveal the token authentication key",
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
        }),

    handler: async ({
      library,
      showSecret,
      profile,
      output,
      verbose,
      apiKey,
    }) => {
      const config = resolveConfig(profile, apiKey, verbose);
      const ctx = toolContext(config, { verbose });
      const lib = await resolveLibraryRef(ctx, library, {
        output,
        offerLink: true,
      });

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
