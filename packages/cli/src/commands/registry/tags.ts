import { registryTags } from "@bunny.net/tools/registry";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";

interface TagsArgs {
  repository: string;
}

export const registryTagsCommand = defineToolCommand({
  tool: registryTags,
  command: "tags <repository>",
  describe: "List tags for a repository in the bunny.net registry.",
  examples: [["$0 registry tags myapp", "List tags for myapp"]],

  builder: (yargs) =>
    yargs.positional("repository", {
      type: "string",
      describe: "Repository to list tags for (e.g. myapp)",
      demandOption: true,
    }),

  prepare: async (args: TagsArgs) => ({
    input: { repository: args.repository },
  }),

  render: ({ repository, tags }, { output }) => {
    if (tags.length === 0) {
      logger.info(`No tags found for ${repository}.`);
      return;
    }
    logger.log(
      formatTable(
        ["Tag"],
        tags.map((tag) => [tag]),
        output,
      ),
    );
  },
});
