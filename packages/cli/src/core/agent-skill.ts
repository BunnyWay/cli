import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** AGENTS.md is the cross-agent instruction file; managed blocks are created or replaced there. */
export const AGENTS_FILE = "AGENTS.md";

/** A skill installable into a project or the user's global Claude Code setup. */
export interface ProjectSkill {
  name: string;
  agentsSection: string;
  files: Record<string, string>;
}

/** Markers delimiting a managed AGENTS.md block so reinstalls update in place. */
export function agentsMarkers(name: string): { start: string; end: string } {
  return { start: `<!-- ${name}:start -->`, end: `<!-- ${name}:end -->` };
}

/** True when the named managed block is already present in the project's AGENTS.md. */
export function isProjectSkillInstalled(cwd: string, name: string): boolean {
  const path = join(cwd, AGENTS_FILE);
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(agentsMarkers(name).start);
}

/** True when the project shows Claude Code usage, gating .claude/skills writes. */
export function usesClaude(cwd: string): boolean {
  return existsSync(join(cwd, ".claude")) || existsSync(join(cwd, "CLAUDE.md"));
}

function wrapSection(name: string, body: string): string {
  const { start, end } = agentsMarkers(name);
  return `${start}\n\n${body.trim()}\n\n${end}`;
}

function upsertAgentsBlock(cwd: string, name: string, body: string): string {
  const path = join(cwd, AGENTS_FILE);
  const section = wrapSection(name, body);
  if (!existsSync(path)) {
    writeFileSync(path, `# Agent instructions\n\n${section}\n`);
    return AGENTS_FILE;
  }
  const current = readFileSync(path, "utf8");
  const { start, end } = agentsMarkers(name);
  const startAt = current.indexOf(start);
  const endAt = current.indexOf(end);
  if (startAt !== -1 && endAt !== -1) {
    const before = current.slice(0, startAt);
    const after = current.slice(endAt + end.length);
    writeFileSync(path, `${before}${section}${after}`);
    return AGENTS_FILE;
  }
  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(path, `${current}${separator}${section}\n`);
  return AGENTS_FILE;
}

function writeSkillFiles(root: string, skill: ProjectSkill): string[] {
  const written: string[] = [];
  for (const [relPath, content] of Object.entries(skill.files)) {
    const target = join(root, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    written.push(target);
  }
  return written;
}

/**
 * Install or update a skill in the current project.
 *
 * Always maintains a marked block in AGENTS.md; additionally writes the skill
 * files under .claude/skills/<name>/ when the project already uses Claude Code.
 * Returns the relative paths written. Idempotent: reruns refresh the same files.
 */
export function installProjectSkill(
  cwd: string,
  skill: ProjectSkill,
): string[] {
  const written: string[] = [
    upsertAgentsBlock(cwd, skill.name, skill.agentsSection),
  ];
  if (usesClaude(cwd)) {
    const root = join(cwd, ".claude/skills", skill.name);
    writeSkillFiles(root, skill);
    for (const relPath of Object.keys(skill.files)) {
      written.push(join(".claude/skills", skill.name, relPath));
    }
  }
  return written;
}

/**
 * Install or update a skill globally for the current user.
 *
 * Writes the skill files under ~/.claude/skills/<name>/ so Claude Code picks it
 * up in every project. Returns the absolute paths written.
 */
export function installGlobalSkill(
  skill: ProjectSkill,
  home = homedir(),
): string[] {
  return writeSkillFiles(join(home, ".claude/skills", skill.name), skill);
}
