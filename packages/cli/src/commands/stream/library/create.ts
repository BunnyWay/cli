import { createCoreClient } from "@bunny.net/openapi-client";
import {
  allRegions,
  DEFAULT_REPLICATION_REGIONS,
  parseReplicationRegions,
  REGION_CODES,
} from "@bunny.net/tools/stream";
import {
  toSafeVideoLibrary,
  type VideoLibraryCreateModel,
  type VideoLibraryModel,
} from "@/commands/stream/api.ts";
import { nameArg } from "@/commands/stream/name-arg.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, spinner } from "@/core/ui.ts";
import {
  type LibrarySettingsArgs,
  librarySettingsFromFlags,
  librarySettingsWarnings,
  withLibrarySettingsOptions,
} from "./flags.ts";
import { checkTranscribingLanguages } from "./language-check.ts";

interface LibraryCreateArgs extends LibrarySettingsArgs {
  libraryName?: string;
  replicationRegions?: string[];
  playerVersion?: number;
}

export const streamLibraryCreateCommand = defineCommand<LibraryCreateArgs>({
  command: "create [library-name]",
  aliases: ["add"],
  describe: "Create a new Stream video library.",
  examples: [
    ["$0 stream library create my-library", "Create a video library"],
    ["$0 stream library create --name my-library", "Same, as a flag"],
    ["$0 stream library create", "Interactive: prompts for the name"],
    [
      "$0 stream library create my-library --replication-regions NY,SG",
      "Replicate to New York and Singapore only (plus DE, the main region)",
    ],
    [
      "$0 stream library create internal --replication-regions DE",
      "Keep everything in DE, with no replication",
    ],
    [
      "$0 stream library create my-library --encoding-tier premium --codecs x264,vp9",
      "Create with premium encoding and extra codecs",
    ],
    [
      "$0 stream library create my-library --transcribing --transcribing-languages en,de",
      "Create with transcribing enabled",
    ],
  ],

  builder: (yargs) =>
    withLibrarySettingsOptions(
      yargs
        .positional("library-name", {
          type: "string",
          describe: "Name for the new video library",
        })
        .option("name", {
          type: "string",
          describe: "Name for the new video library",
        })
        .option("replication-regions", {
          type: "string",
          array: true,
          describe: `Replication regions besides DE, the fixed main region (comma-separated or repeated; default ${DEFAULT_REPLICATION_REGIONS.join(",")}; codes ${REGION_CODES.join(", ")}). Pass DE alone for no replication`,
        })
        .option("player-version", {
          type: "number",
          choices: [1, 2],
          describe: "Player to use: 1 = legacy, 2 = current",
        }),
    ),

  handler: async (args) => {
    const {
      libraryName,
      replicationRegions,
      profile,
      output,
      verbose,
      apiKey,
    } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    let nameInput = nameArg(libraryName, args.name);
    if (!nameInput && isInteractive(output)) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Name for the new video library:",
      });
      nameInput = typeof value === "string" ? value.trim() : value;
    }
    if (!nameInput) {
      throw new UserError(
        "A library name is required.",
        "Pass the name: bunny stream library create my-library",
      );
    }
    const name = nameInput;

    // Accept both `--replication-regions NY,SG` and repeated flags. Omitted means
    // the default set; DE is the fixed main region, so it is never sent.
    const regions =
      replicationRegions === undefined
        ? [...DEFAULT_REPLICATION_REGIONS]
        : parseReplicationRegions(replicationRegions);
    const warnings = librarySettingsWarnings(args);

    // The encoding/transcribing flags are shared with `library update`; Name is
    // set explicitly here because create takes it from the positional too.
    const body: VideoLibraryCreateModel = {
      ...librarySettingsFromFlags({ ...args, name: undefined }),
      Name: name,
    };
    body.ReplicationRegions = regions;
    if (args.playerVersion !== undefined)
      body.PlayerVersion = args.playerVersion;
    await checkTranscribingLanguages(
      config,
      body.TranscribingCaptionLanguages,
      verbose,
    );

    const spin = spinner("Creating video library...");
    spin.start();
    let created: VideoLibraryModel | undefined;
    try {
      const { data } = await client.POST("/videolibrary", { body });
      created = data;
    } finally {
      spin.stop();
    }

    if (output === "json") {
      // The create response carries the new library's keys; read them back on
      // purpose with `bunny stream library credentials`.
      logger.log(
        JSON.stringify(
          created ? toSafeVideoLibrary(created) : { Name: name },
          null,
          2,
        ),
      );
      return;
    }

    const where = `replicated to ${allRegions(regions).join(", ")}`;
    logger.success(
      created?.Id
        ? `Created video library ${name} (ID: ${created.Id}), ${where}.`
        : `Created video library ${name}, ${where}.`,
    );
    for (const warning of warnings) logger.warn(warning);
  },
});
