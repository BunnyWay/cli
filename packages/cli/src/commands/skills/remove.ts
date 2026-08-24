import {
  AGENTS_FILE,
  removeGlobalSkill,
  removeProjectSkill,
} from "../../core/agent-skill.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { confirm, requireConfirmable } from "../../core/ui.ts";
import { BUNNY_CLI_SKILL } from "./content.ts";

const COMMAND = "remove";
const ALIASES = ["rm", "uninstall"] as const;
const DESCRIPTION = "Remove the bunny agent skill.";

interface RemoveArgs {
  global?: boolean;
  force: boolean;
}

/**
 * Remove the bunny-cli agent skill.
 *
 * Project removal (default) strips the marked block from AGENTS.md and deletes
 * .agents/skills/bunny-cli/ and .claude/skills/bunny-cli/. A global removal
 * deletes the skill from ~/.agents/skills/ and ~/.claude/skills/. Everything
 * removed is regenerable with `bunny skills install`.
 *
 * @example
 * ```bash
 * bunny skills remove
 * bunny skills remove --global --force
 * ```
 */
export const skillsRemoveCommand = defineCommand<RemoveArgs>({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    [
      "$0 skills remove",
      "Remove from this project (AGENTS.md and .agents/skills)",
    ],
    [
      "$0 skills remove --global",
      "Remove from ~/.agents/skills and ~/.claude/skills",
    ],
  ],

  builder: (yargs) =>
    yargs
      .option("global", {
        type: "boolean",
        default: false,
        describe:
          "Remove from the global skills directories instead of the current project",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Skip confirmation",
      }),

  handler: async ({ global: isGlobal, force, output }) => {
    requireConfirmable(output, {
      force,
      message: "Removing the skill requires confirmation.",
      hint: "Pass --force to remove without a prompt.",
    });
    const target = isGlobal
      ? "~/.agents/skills and ~/.claude/skills"
      : "this project";
    const ok = await confirm(`Remove the bunny agent skill from ${target}?`, {
      force,
    });
    if (!ok) {
      logger.log("Removal cancelled.");
      process.exit(1);
    }

    const removed = isGlobal
      ? removeGlobalSkill(BUNNY_CLI_SKILL.name)
      : removeProjectSkill(process.cwd(), BUNNY_CLI_SKILL.name);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { scope: isGlobal ? "global" : "project", removed },
          null,
          2,
        ),
      );
      return;
    }

    if (removed.length === 0) {
      logger.log("Nothing to remove: the bunny agent skill is not installed.");
      return;
    }
    for (const path of removed) {
      logger.success(
        path === AGENTS_FILE
          ? `Removed the bunny skill from ${AGENTS_FILE}`
          : `Removed ${path}`,
      );
    }
  },
});
