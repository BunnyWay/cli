import { createCoreClient } from "@bunny.net/openapi-client";
import { streamLibrariesRotateKey } from "@bunny.net/tools/stream";
import { resolveLibraryInteractive } from "@/commands/stream/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatKeyValue, maskSecret } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";

interface CredentialsArgs {
  library?: string;
  readOnly?: boolean;
  showSecret?: boolean;
  rotate?: boolean;
  force?: boolean;
}

export const streamLibraryCredentialsCommand = defineCommand<CredentialsArgs>({
  command: "credentials [library]",
  aliases: ["creds"],
  describe: "Show the Stream API keys for a video library.",
  examples: [
    [
      "$0 stream library credentials my-library",
      "Show the library ID and API key (key masked)",
    ],
    [
      "$0 stream library credentials my-library --show-secret",
      "Reveal the API key",
    ],
    [
      "$0 stream library credentials my-library --read-only",
      "Use the read-only API key instead",
    ],
    [
      "$0 stream library credentials my-library --rotate",
      "Reset the API key, then show the new one (masked)",
    ],
    [
      "$0 stream library credentials my-library --rotate --read-only --force",
      "Reset the read-only key without asking",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("library", {
        type: "string",
        describe: "Video library name or ID",
      })
      .option("read-only", {
        type: "boolean",
        default: false,
        describe: "Show the library's read-only API key",
      })
      .option("show-secret", {
        type: "boolean",
        default: false,
        describe: "Reveal the API key (masked by default)",
      })
      .option("rotate", {
        type: "boolean",
        default: false,
        describe:
          "Reset the key (or the read-only key with --read-only); anything using the old key stops working",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip the rotation confirmation",
      }),

  handler: async ({
    library,
    readOnly,
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
        message: "Rotating an API key needs confirmation.",
        hint: "Pass --force to rotate it without a prompt.",
      });
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const lib = await resolveLibraryInteractive(client, library, {
      output,
      force: rotate ? force : undefined,
    });

    const keyKind = readOnly ? "Read-only API key" : "API key";
    const keyLabel = readOnly ? "read-only API key" : "API key";

    let rotatedKey: string | undefined;
    if (rotate) {
      const approved = await confirm(
        `Reset the ${keyLabel} for ${lib.Name ?? lib.Id}? Anything still using the old key stops working.`,
        { force },
      );
      if (!approved) {
        logger.log("Cancelled.");
        return;
      }
      // Rotation goes through the stream tools; they reset, then read the new key back.
      const rotated = await withSpinner("Rotating API key...", () =>
        streamLibrariesRotateKey.invoke(toolContext(config, { verbose }), {
          library: lib.Id as number,
          readOnly: readOnly ?? false,
        }),
      );
      rotatedKey = rotated.apiKey;
      if (output !== "json") logger.success(`Rotated the ${keyLabel}.`);
    }

    // A masked empty string reads as "here is your key" and exits 0; say what happened.
    const key = rotatedKey ?? (readOnly ? lib.ReadOnlyApiKey : lib.ApiKey);
    if (!key) {
      throw new UserError(
        `No ${keyLabel} available for video library ${lib.Name ?? lib.Id}.`,
        "The account key may not be allowed to read it; check the library in the bunny.net dashboard.",
      );
    }

    if (output === "json") {
      // Mask by default like the table; --show-secret opts into the raw key.
      logger.log(
        JSON.stringify(
          {
            libraryId: lib.Id,
            name: lib.Name,
            readOnly: readOnly ?? false,
            rotated: rotate ?? false,
            apiKey: showSecret ? key : maskSecret(key),
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "Library ID", value: String(lib.Id ?? "") },
          { key: "Name", value: lib.Name ?? "" },
          { key: keyKind, value: showSecret ? key : maskSecret(key) },
        ],
        output,
      ),
    );
    if (showSecret) {
      logger.warn("Treat the API key like a password.");
    } else {
      logger.dim("Key masked. Pass --show-secret to reveal it.");
    }
  },
});
