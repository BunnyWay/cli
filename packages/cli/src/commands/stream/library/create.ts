import { createCoreClient } from "@bunny.net/openapi-client";
import {
  toSafeVideoLibrary,
  type VideoLibraryCreateModel,
  type VideoLibraryModel,
} from "@/commands/stream/api.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, spinner } from "@/core/ui.ts";
import {
  type LibrarySettingsArgs,
  librarySettingsFromFlags,
  withLibrarySettingsOptions,
} from "./flags.ts";

interface LibraryCreateArgs extends LibrarySettingsArgs {
  libraryName?: string;
  replicationRegions?: string[];
}

/**
 * The name for the new library, from the positional or `--name`.
 *
 * Both are accepted, but giving both with different values is a mistake worth
 * reporting rather than silently picking a winner.
 */
export function createLibraryName(
  positional: string | undefined,
  flag: string | undefined,
): string | undefined {
  const fromPositional = positional?.trim();
  const fromFlag = flag?.trim();

  if (fromPositional && fromFlag && fromPositional !== fromFlag) {
    throw new UserError(
      `Conflicting names: "${fromPositional}" and --name "${fromFlag}".`,
      "Pass the name once, either as the argument or as --name.",
    );
  }
  return fromFlag || fromPositional || undefined;
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
      "Create a library replicated to New York and Singapore",
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
          describe:
            "Replication region codes for the underlying storage zone, set at creation time (comma-separated or repeated)",
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

    let nameInput = createLibraryName(libraryName, args.name);
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

    // Accept both `--replication-regions NY,SG` and repeated flags.
    const regions = (replicationRegions ?? [])
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    // The encoding/transcribing flags are shared with `library update`; Name is
    // set explicitly here because create takes it from the positional too.
    const body: VideoLibraryCreateModel = {
      ...librarySettingsFromFlags({ ...args, name: undefined }),
      Name: name,
    };
    if (regions.length) body.ReplicationRegions = regions;

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

    logger.success(
      created?.Id
        ? `Created video library ${name} (ID: ${created.Id}).`
        : `Created video library ${name}.`,
    );
  },
});
