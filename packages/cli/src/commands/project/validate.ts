import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import {
  loadProjectConfig,
  projectConfigPath,
} from "../../core/project-config.ts";

const COMMAND = "validate";
const DESCRIPTION = "Validate the project config against its schema.";

const ARG_CONFIG = "config";

interface ValidateArgs {
  [ARG_CONFIG]?: string;
}

/** Validate bunny.jsonc (exits non-zero with per-field issues when invalid) — CI-friendly. */
export const projectValidateCommand = defineCommand<ValidateArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 project validate", "Validate the nearest bunny.jsonc"],
    ["$0 project validate --output json", "Machine-readable result"],
  ],

  builder: (yargs) =>
    yargs.option(ARG_CONFIG, {
      type: "string",
      describe: "Path to a project config file",
    }),

  handler: async (args) => {
    const { output } = args;
    const config = loadProjectConfig(args[ARG_CONFIG]);
    const path = projectConfigPath(args[ARG_CONFIG]);

    if (output === "json") {
      logger.log(
        JSON.stringify({ valid: true, path, name: config.name ?? null }),
      );
      return;
    }

    logger.success(`${path} is valid.`);
  },
});
