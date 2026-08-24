import {
  installGlobalSkill,
  installProjectSkill,
} from "../../core/agent-skill.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { BUNNY_CLI_SKILL } from "./content.ts";

const COMMAND = "install";
const ALIASES = ["add", "update"] as const;
const DESCRIPTION =
  "Install the bunny agent skill so AI coding tools know how to use the CLI.";

interface InstallArgs {
  global?: boolean;
}

/**
 * Install the bunny-cli agent skill.
 *
 * Project install (default) maintains a marked block in AGENTS.md, which most
 * coding agents read, and writes the full skill with references under
 * .agents/skills/bunny-cli/, plus .claude/skills/bunny-cli/ when the project
 * uses Claude Code. Installing into the home directory or the filesystem root
 * is refused, since neither is a project. A global install writes the skill to
 * ~/.agents/skills/bunny-cli/ (the cross-tool directory) and
 * ~/.claude/skills/bunny-cli/ so AI coding tools pick it up in every project.
 * Reinstalling refreshes the same files, so `update` is an alias.
 *
 * @example
 * ```bash
 * bunny skills install
 * bunny skills install --global
 * ```
 */
export const skillsInstallCommand = defineCommand<InstallArgs>({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    [
      "$0 skills install",
      "Install into this project (AGENTS.md and .agents/skills)",
    ],
    [
      "$0 skills install --global",
      "Install to ~/.agents/skills and ~/.claude/skills for every project",
    ],
  ],

  builder: (yargs) =>
    yargs.option("global", {
      type: "boolean",
      default: false,
      describe:
        "Install to ~/.agents/skills and ~/.claude/skills instead of the current project",
    }),

  handler: async ({ global: isGlobal, output }) => {
    const files = isGlobal
      ? installGlobalSkill(BUNNY_CLI_SKILL)
      : installProjectSkill(process.cwd(), BUNNY_CLI_SKILL);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { scope: isGlobal ? "global" : "project", files },
          null,
          2,
        ),
      );
      return;
    }

    for (const file of files) logger.success(`Wrote ${file}`);
    logger.dim(
      isGlobal
        ? "AI coding tools now know how to use the bunny CLI in every project."
        : "AI coding tools working in this project now know how to use the bunny CLI.",
    );
  },
});
