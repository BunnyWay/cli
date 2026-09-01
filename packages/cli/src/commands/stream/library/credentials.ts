import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatKeyValue, maskSecret } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveLibraryInteractive } from "../interactive.ts";

interface CredentialsArgs {
  library?: string;
  readOnly?: boolean;
  showSecret?: boolean;
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
      }),

  handler: async ({
    library,
    readOnly,
    showSecret,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const lib = await resolveLibraryInteractive(client, library, { output });

    const keyKind = readOnly ? "Read-only API key" : "API key";

    // A masked empty string reads as "here is your key" and exits 0; say what happened.
    const key = readOnly ? lib.ReadOnlyApiKey : lib.ApiKey;
    if (!key) {
      throw new UserError(
        `No ${keyKind.toLowerCase()} available for video library ${lib.Name ?? lib.Id}.`,
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
