import { streamSecurityTokenKey } from "@bunny.net/tools/stream";
import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import { withSpinner } from "@/core/ui.ts";
import { embedUrl, parseDuration, signEmbedUrl } from "./embed-url.ts";

interface VideoEmbedArgs {
  video?: string;
  lib?: string;
  expires?: string;
}

export const streamVideoEmbedCommand = defineCommand<VideoEmbedArgs>({
  command: "embed [video]",
  describe:
    "Print a video's player embed URL, signed when the library requires embed view tokens.",
  examples: [
    ["$0 stream video embed 1a2b3c4d-...", "Print the embed URL"],
    [
      "$0 stream video embed 1a2b3c4d-... --expires 30m",
      "Sign it for 30 minutes on a token-protected library",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", { type: "string", describe: "Video GUID" })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("expires", {
        type: "string",
        default: "1h",
        describe:
          "How long a signed URL stays valid, e.g. 30m, 1h, 7d (only used when embed tokens are on)",
      }),

  handler: async ({
    video: ref,
    lib,
    expires,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const ttl = parseDuration(expires ?? "1h");
    const { library, libraryId, client } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });
    const video = await resolveVideoInteractive(client, libraryId, ref, {
      output,
    });

    const url = embedUrl(libraryId, video.guid);
    const signed = library.PlayerTokenAuthenticationEnabled ?? false;
    let result = url;
    let expiresAt: number | undefined;
    if (signed) {
      // The token key lives on the linked Pull Zone; it is used here and never printed.
      const config = resolveConfig(profile, apiKey, verbose);
      const { key } = await withSpinner("Fetching the token key...", () =>
        streamSecurityTokenKey.invoke(toolContext(config, { verbose }), {
          library: libraryId,
        }),
      );
      expiresAt = Math.floor(Date.now() / 1000) + ttl;
      result = signEmbedUrl(url, video.guid, key, expiresAt);
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            id: video.guid,
            libraryId,
            url: result,
            signed,
            expires: expiresAt
              ? new Date(expiresAt * 1000).toISOString()
              : null,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.log(result);
    if (expiresAt) {
      logger.dim(
        `Signed; valid until ${new Date(expiresAt * 1000).toISOString()}.`,
      );
    }
  },
});
