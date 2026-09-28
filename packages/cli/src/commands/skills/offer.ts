import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfigFile } from "@/config/index.ts";
import {
  installGlobalSkill,
  isGlobalSkillInstalled,
  isProjectSkillInstalled,
} from "@/core/agent-skill.ts";
import { logger } from "@/core/logger.ts";
import { confirmOrCancel, isInteractive } from "@/core/ui.ts";
import { CACHE_DIR } from "@/core/update-check.ts";
import { BUNNY_CLI_SKILL } from "./content.ts";

// Losing the cache dir only means one repeat offer.
const OFFER_MARKER = join(CACHE_DIR, "skills-offered");

const INSTALL_COMMAND = "bunny skills install --global";

// Set once login has handled the offer (prompt or flag), so the post-command hint stays quiet in the same process.
let promptedThisRun = false;

function shouldOffer(output?: string): boolean {
  return (
    isInteractive(output) &&
    !existsSync(OFFER_MARKER) &&
    !isGlobalSkillInstalled(BUNNY_CLI_SKILL.name)
  );
}

function markOffered(): void {
  mkdirSync(dirname(OFFER_MARKER), { recursive: true });
  writeFileSync(OFFER_MARKER, `${new Date().toISOString()}\n`);
}

// Marks offered only on success, so a failed install is offered again on the next login.
function installAndReport(): void {
  try {
    installGlobalSkill(BUNNY_CLI_SKILL);
    markOffered();
    logger.success(
      "Agent skill installed to ~/.agents/skills and ~/.claude/skills.",
    );
  } catch (err) {
    logger.warn(
      `Couldn't install the agent skill (${err instanceof Error ? err.message : err}); run: ${INSTALL_COMMAND}`,
    );
  }
}

/** One-time interactive offer to install the agent skill globally; never throws or blocks unattended runs. An explicit `installSkill` flag decides without prompting. */
export async function offerGlobalSkillInstall(
  output?: string,
  installSkill?: boolean,
): Promise<void> {
  try {
    if (installSkill === false) return;
    if (installSkill === true) {
      promptedThisRun = true;
      installAndReport();
      return;
    }
    if (!shouldOffer(output)) return;
    promptedThisRun = true;
    logger.log();
    const answer = await confirmOrCancel(
      "Install the bunny agent skill so AI coding tools (Claude Code, Cursor, Codex, ...) know how to use this CLI?",
      { initial: true },
    );
    // An interrupted prompt is not an answer; the next login offers again.
    if (answer === "cancel") return;
    if (answer === "no") {
      markOffered();
      logger.dim(`You can install it any time with: ${INSTALL_COMMAND}`);
      return;
    }
    installAndReport();
  } catch {}
}

function hasCredentials(): boolean {
  if (process.env.BUNNYNET_API_KEY) return true;
  const file = loadConfigFile();
  return Object.keys(file?.profiles ?? {}).length > 0;
}

/** One-time passive stderr hint for users who authenticated without `bunny login`; never throws or prompts. */
export function hintGlobalSkillInstall(): void {
  try {
    if (
      promptedThisRun ||
      !shouldOffer() ||
      !hasCredentials() ||
      isProjectSkillInstalled(process.cwd(), BUNNY_CLI_SKILL.name)
    ) {
      return;
    }
    markOffered();
    logger.dim(
      `\nTip: run \`${INSTALL_COMMAND}\` so AI coding tools (Claude Code, Cursor, Codex, ...) know how to use this CLI.`,
    );
  } catch {}
}
