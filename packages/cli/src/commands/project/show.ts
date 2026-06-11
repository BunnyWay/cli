import chalk from "chalk";
import { defineCommand } from "../../core/define-command.ts";
import { formatKeyValue, formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import {
  loadProjectConfig,
  projectConfigPath,
} from "../../core/project-config.ts";

const COMMAND = "show";
const DESCRIPTION = "Show the project's resource map.";

const ARG_CONFIG = "config";

interface ShowArgs {
  [ARG_CONFIG]?: string;
}

/** Print the validated project config: project metadata plus one table per resource kind. */
export const projectShowCommand = defineCommand<ShowArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 project show", "Show the nearest bunny.jsonc"],
    ["$0 project show --output json", "Machine-readable resource map"],
  ],

  builder: (yargs) =>
    yargs.option(ARG_CONFIG, {
      type: "string",
      describe: "Path to a project config file",
    }),

  handler: async (args) => {
    const { output } = args;
    const config = loadProjectConfig(args[ARG_CONFIG]);

    if (output === "json") {
      logger.log(JSON.stringify(config, null, 2));
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "Project", value: config.name ?? config.app?.name ?? "—" },
          { key: "Version", value: config.version },
          { key: "Path", value: projectConfigPath(args[ARG_CONFIG]) },
        ],
        output,
      ),
    );

    const databases = Object.entries(config.databases ?? {});
    logger.log();
    logger.log(chalk.bold("Databases"));
    if (databases.length === 0) {
      logger.dim("  None mapped. Run `bunny project add database <binding>`.");
    } else {
      logger.log(
        formatTable(
          ["Binding", "Name", "ID"],
          databases.map(([binding, db]) => [binding, db.name ?? "—", db.id]),
          output,
        ),
      );
    }

    const scripts = Object.entries(config.scripts ?? {});
    logger.log();
    logger.log(chalk.bold("Scripts"));
    if (scripts.length === 0) {
      logger.dim("  None mapped. Run `bunny project add script <binding>`.");
    } else {
      logger.log(
        formatTable(
          ["Binding", "Name", "ID", "Type", "Entry"],
          scripts.map(([binding, script]) => [
            binding,
            script.name ?? "—",
            String(script.id),
            script.type ?? "—",
            script.entry ?? "—",
          ]),
          output,
        ),
      );
    }
  },
});
