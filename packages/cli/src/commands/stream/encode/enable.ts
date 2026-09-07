import { createCoreClient } from "@bunny.net/openapi-client";
import {
  toSafeVideoLibrary,
  type VideoLibraryUpdateModel,
} from "@/commands/stream/api.ts";
import { resolveLibraryInteractive } from "@/commands/stream/interactive.ts";
import {
  CODEC_CHOICES,
  type LibrarySettingsArgs,
  librarySettingsFromFlags,
  RESOLUTION_CHOICES,
} from "@/commands/stream/library/flags.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface EncodeEnableArgs
  extends Pick<LibrarySettingsArgs, "jit" | "codecs" | "resolutions"> {
  lib?: string;
}

const BILLING_NOTE =
  "Premium encoding is billed per output codec per minute of encoded video.";

/**
 * The update body for switching a library to premium encoding.
 *
 * EncodingTier 1 is the whole point of the command, so it is always sent; the
 * optional flags ride along in the same request.
 */
export function encodeEnableBody(
  args: EncodeEnableArgs,
): VideoLibraryUpdateModel {
  return {
    ...librarySettingsFromFlags({
      jit: args.jit,
      codecs: args.codecs,
      resolutions: args.resolutions,
    }),
    EncodingTier: 1,
  };
}

export const streamEncodeEnableCommand = defineCommand<EncodeEnableArgs>({
  command: "enable",
  describe: "Switch a video library to premium encoding.",
  examples: [
    [
      "$0 stream encode enable",
      "Enable premium encoding on the linked library",
    ],
    ["$0 stream encode enable --lib 12345 --jit", "Also enable JIT encoding"],
    [
      "$0 stream encode enable --codecs x264,vp9 --resolutions 720p,1080p",
      "Enable premium encoding with codecs and resolutions in one call",
    ],
  ],

  builder: (yargs) =>
    yargs
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("jit", {
        type: "boolean",
        describe:
          "Enable just-in-time encoding, which premium unlocks (--no-jit disables it)",
      })
      .option("codecs", {
        type: "string",
        describe: `Output codecs, comma-separated: ${CODEC_CHOICES.join(", ")}`,
      })
      .option("resolutions", {
        type: "string",
        describe: `Enabled resolutions, comma-separated: ${RESOLUTION_CHOICES.join(", ")}`,
      }),

  handler: async (args) => {
    const { lib, profile, output, verbose, apiKey } = args;
    // Validate the flags before any network call.
    const body = encodeEnableBody(args);

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const library = await resolveLibraryInteractive(client, lib, {
      output,
      offerLink: true,
    });

    // Text runs see the cost before the request; json output stays machine-clean.
    if (output !== "json") logger.warn(BILLING_NOTE);

    const updated = await withSpinner(
      "Enabling premium encoding...",
      async () => {
        const { data } = await client.POST("/videolibrary/{id}", {
          params: { path: { id: library.Id as number } },
          body,
        });
        return data;
      },
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          updated ? toSafeVideoLibrary(updated) : { Id: library.Id, ...body },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(
      `Premium encoding enabled on ${updated?.Name ?? library.Name}.`,
    );
    logger.dim(`Changed: ${Object.keys(body).join(", ")}.`);
  },
});
