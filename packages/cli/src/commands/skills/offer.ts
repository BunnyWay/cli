import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  installGlobalSkill,
  isGlobalSkillInstalled,
} from "../../core/agent-skill.ts";
import { logger } from "../../core/logger.ts";
import { confirm, isInteractive } from "../../core/ui.ts";
import { CACHE_DIR } from "../../core/update-check.ts";
import { BUNNY_CLI_SKILL } from "./content.ts";

// Losing the cache dir only means one repeat offer.
const OFFER_MARKER = join(CACHE_DIR, "skills-offered");

/** One-time interactive offer to install the agent skill globally; never throws or blocks unattended runs. */
export async function offerGlobalSkillInstall(output?: string): Promise<void> {
  try {
    if (
      !isInteractive(output) ||
      existsSync(OFFER_MARKER) ||
      isGlobalSkillInstalled(BUNNY_CLI_SKILL.name)
    ) {
      return;
    }
    // Marked before prompting so an interrupted prompt still counts as offered.
    mkdirSync(dirname(OFFER_MARKER), { recursive: true });
    writeFileSync(OFFER_MARKER, `${new Date().toISOString()}\n`);

    logger.log();
    const ok = await confirm(
      "Install the bunny agent skill so AI coding tools (Claude Code, Cursor, Codex, ...) know how to use this CLI?",
      { initial: true },
    );
    if (!ok) {
      logger.dim(
        "You can install it any time with: bunny skills install --global",
      );
      return;
    }
    installGlobalSkill(BUNNY_CLI_SKILL);
    logger.success(
      "Agent skill installed to ~/.agents/skills and ~/.claude/skills.",
    );
  } catch {}
}
