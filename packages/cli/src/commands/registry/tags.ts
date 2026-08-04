import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import {
  fetchRegistryNamespace,
  qualifyRepository,
  registryRequest,
  resolveRegistryEndpoint,
  stripNamespace,
} from "./client.ts";

const COMMAND = "tags <repository>";
const DESCRIPTION = "List tags for a repository in the bunny.net registry.";

interface TagList {
  name?: string;
  tags?: string[];
}

interface TagsArgs {
  repository: string;
}

export const registryTagsCommand = defineCommand<TagsArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [["$0 registry tags myapp", "List tags for myapp"]],

  builder: (yargs) =>
    yargs.positional("repository", {
      type: "string",
      describe: "Repository to list tags for (e.g. myapp)",
      demandOption: true,
    }),

  handler: async ({ repository, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    if (!config.apiKey) {
      throw new UserError(
        "Not logged in.",
        'Run "bunny login" to authenticate.',
      );
    }

    const endpoint = resolveRegistryEndpoint();

    const spin = spinner(`Fetching tags for ${repository}...`);
    spin.start();
    let result: TagList;
    let displayRepo: string;
    try {
      const namespace = await fetchRegistryNamespace(config, verbose);
      const repo = qualifyRepository(repository, namespace);
      displayRepo = stripNamespace(repo, namespace);
      result = await registryRequest<TagList>(
        endpoint,
        config.apiKey,
        `/v2/${repo}/tags/list`,
      );
    } finally {
      spin.stop();
    }

    const tags = result.tags ?? [];

    if (output === "json") {
      logger.log(JSON.stringify({ repository: displayRepo, tags }, null, 2));
      return;
    }

    if (tags.length === 0) {
      logger.info(`No tags found for ${displayRepo}.`);
      return;
    }

    logger.log(
      formatTable(
        ["Tag"],
        tags.map((t) => [t]),
        output,
      ),
    );
  },
});
