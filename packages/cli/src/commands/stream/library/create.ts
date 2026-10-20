import { createCoreClient } from "@bunny.net/openapi-client";
import {
  toSafeVideoLibrary,
  type VideoLibraryCreateModel,
  type VideoLibraryModel,
} from "@/commands/stream/api.ts";
import { regionName } from "@/commands/stream/regions.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import { confirmOrCancel, isInteractive, prompts, spinner } from "@/core/ui.ts";
import {
  allRegions,
  MAIN_REGION,
  parseReplicationRegions,
  REGION_CODES,
  SUGGESTED_REPLICATION_REGIONS,
} from "@/tools/stream/index.ts";
import {
  ENV_STREAM_API_KEY,
  ENV_STREAM_CDN_HOSTNAME,
  ENV_STREAM_LIBRARY_ID,
  offerAddVideos,
  offerLink,
  offerSaveEnv,
  printNextSteps,
} from "./create-next-steps.ts";
import {
  type LibrarySettingsArgs,
  librarySettingsFromFlags,
  librarySettingsWarnings,
  withLibrarySettingsOptions,
} from "./flags.ts";
import { checkTranscribingLanguages } from "./language-check.ts";

async function resolveReplicationRegions(
  flag: string[] | undefined,
  output: string | undefined,
): Promise<string[]> {
  if (flag !== undefined) return parseReplicationRegions(flag);
  if (!isInteractive(output)) return [];

  const answer = await confirmOrCancel(
    "Replicate this library to other regions? Replicas can't be removed once added.",
  );
  if (answer === "cancel") throw new UserError("Creation cancelled.");
  if (answer === "no") return [];

  const { picked } = await prompts({
    type: "multiselect",
    name: "picked",
    message: "Replication regions (each adds storage cost; space to toggle):",
    choices: REGION_CODES.filter((code) => code !== MAIN_REGION).map(
      (code) => ({
        title: `${regionName(code)} (${code})`,
        value: code,
        selected: SUGGESTED_REPLICATION_REGIONS.includes(code),
      }),
    ),
  });

  if (picked === undefined) throw new UserError("Creation cancelled.");
  return picked;
}

interface LibraryCreateArgs extends LibrarySettingsArgs {
  replicationRegions?: string[];
  playerVersion?: number;
  link?: boolean;
  saveEnv?: boolean;
  addVideos?: boolean;
}

export const streamLibraryCreateCommand = defineCommand<LibraryCreateArgs>({
  command: "create [name]",
  aliases: ["add"],
  describe: "Create a new Stream video library.",
  examples: [
    ["$0 stream libraries create my-library", "Create a video library"],
    ["$0 stream libraries create", "Interactive: prompts for the name"],
    [
      "$0 stream libraries create my-library --replication-regions NY,SG",
      "Replicate to New York and Singapore (plus DE, the main region)",
    ],
    [
      "$0 stream libraries create internal --replication-regions DE",
      "Keep everything in DE without asking about replication",
    ],
    [
      "$0 stream libraries create my-library --encoding-tier premium --codecs x264,vp9",
      "Create with premium encoding and extra codecs",
    ],
    [
      "$0 stream libraries create my-library --transcribing --transcribing-languages en,de",
      "Create with transcribing enabled",
    ],
    [
      "$0 stream libraries create my-library --link --save-env",
      "Link this directory and save the library ID and API key to .env",
    ],
    [
      "$0 stream libraries create my-library --no-link --no-save-env --no-add-videos",
      "Create without any follow-up prompts",
    ],
  ],

  builder: (yargs) =>
    withLibrarySettingsOptions(
      yargs
        .positional("name", {
          type: "string",
          describe: "Name for the new video library",
        })
        .option("replication-regions", {
          type: "string",
          array: true,
          describe: `Replication regions besides DE, the fixed main region (comma-separated or repeated; codes ${REGION_CODES.join(", ")}). Replicas can't be removed later. Omitted: asks in a terminal, none otherwise. Pass DE alone for no replication`,
        })
        .option("player-version", {
          type: "number",
          choices: [1, 2],
          describe: "Player to use: 1 = legacy, 2 = current",
        })
        .option("link", {
          type: "boolean",
          describe:
            "Link this directory to the new library (skips prompt). Use --no-link to skip without prompting.",
        })
        .option("save-env", {
          type: "boolean",
          describe: `Save ${ENV_STREAM_LIBRARY_ID}, ${ENV_STREAM_API_KEY} and ${ENV_STREAM_CDN_HOSTNAME} to .env (skips prompt). Use --no-save-env to skip without prompting.`,
        })
        .option("add-videos", {
          type: "boolean",
          describe:
            "Ask how to add videos after creating (interactive only). Use --no-add-videos to skip the prompt.",
        }),
    ),

  handler: async (args) => {
    const { replicationRegions, profile, output, verbose, apiKey } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    let nameInput = args.name?.trim() || undefined;
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
        "Pass the name: bunny stream libraries create my-library",
      );
    }
    const name = nameInput;

    const regions = await resolveReplicationRegions(replicationRegions, output);
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
      // No prompts here: only the flags link or save. The create response carries
      // the new library's keys; read them back on purpose with `bunny stream libraries credentials`.
      const linked = created
        ? await offerLink(created, args.link, output)
        : false;
      const savedToEnv = created
        ? await offerSaveEnv(
            created,
            args.saveEnv,
            output,
            toolContext(config, { verbose }),
          )
        : false;
      logger.log(
        JSON.stringify(
          created
            ? {
                ...toSafeVideoLibrary(created),
                Linked: linked,
                SavedToEnv: savedToEnv,
              }
            : { Name: name },
          null,
          2,
        ),
      );
      return;
    }

    const where = regions.length
      ? `replicated to ${allRegions(regions).join(", ")}`
      : `stored in ${MAIN_REGION} only`;
    logger.success(
      created?.Id
        ? `Created video library ${name} (ID: ${created.Id}), ${where}.`
        : `Created video library ${name}, ${where}.`,
    );
    for (const warning of warnings) logger.warn(warning);
    if (!created?.Id) return;

    await offerLink(created, args.link, output);
    await offerSaveEnv(
      created,
      args.saveEnv,
      output,
      toolContext(config, { verbose }),
    );
    if (args.addVideos !== false && isInteractive(output))
      await offerAddVideos(created, { profile, output, verbose, apiKey });
    printNextSteps(created);
  },
});
