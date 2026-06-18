import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { registryRequest, resolveRegistryEndpoint } from "./client.ts";

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
  examples: [["$0 registry tags team/myapp", "List tags for team/myapp"]],

  builder: (yargs) =>
    yargs.positional("repository", {
      type: "string",
      describe: "Repository to list tags for (e.g. team/myapp)",
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
    const repo = repository.replace(/^\/+|\/+$/g, "");

    const spin = spinner(`Fetching tags for ${repo}...`);
    spin.start();
    let result: TagList;
    try {
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
      logger.log(JSON.stringify({ repository: repo, tags }, null, 2));
      return;
    }

    if (tags.length === 0) {
      logger.info(`No tags found for ${repo}.`);
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
