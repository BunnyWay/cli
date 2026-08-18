import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { UserError } from "./errors.ts";

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

/** Heading written when the installer creates AGENTS.md from scratch. */
const DEFAULT_AGENTS_HEADING = "# Agent instructions";

/** Locate the named block's markers, throwing on any malformed arrangement; null when absent. */
function locateMarkedBlock(
  current: string,
  name: string,
): { startAt: number; endAt: number } | null {
  const { start, end } = agentsMarkers(name);
  const startAt = current.indexOf(start);
  const endAt = current.indexOf(end);
  if (startAt === -1 && endAt === -1) return null;
  const duplicated =
    current.indexOf(start, startAt + start.length) !== -1 ||
    current.indexOf(end, endAt + end.length) !== -1;
  if (startAt === -1 || endAt === -1 || endAt < startAt || duplicated) {
    throw new UserError(
      `${AGENTS_FILE} has a malformed ${name} block: expected a single "${start}" followed by a single "${end}". Fix or remove the markers, then rerun.`,
    );
  }
  return { startAt, endAt };
}

/**
 * Return `current` with the named marked block created or replaced.
 *
 * Pure so every marker state is unit-testable: `null` starts a fresh file, no
 * markers appends, a well-formed pair is replaced in place, and a malformed
 * pair (one marker missing, end before start, or duplicated markers) throws
 * instead of guessing, since slicing across misplaced markers would corrupt
 * the user's file.
 */
export function upsertMarkedBlock(
  current: string | null,
  name: string,
  body: string,
): string {
  const { start, end } = agentsMarkers(name);
  const section = `${start}\n\n${body.trim()}\n\n${end}`;
  if (current === null) return `${DEFAULT_AGENTS_HEADING}\n\n${section}\n`;

  const at = locateMarkedBlock(current, name);
  if (at === null) {
    const separator = current.endsWith("\n") ? "\n" : "\n\n";
    return `${current}${separator}${section}\n`;
  }
  const before = current.slice(0, at.startAt);
  const after = current.slice(at.endAt + end.length);
  return `${before}${section}${after}`;
}

/**
 * Return `current` without the named marked block, collapsing the whitespace
 * the block occupied. Returns null when no block is present (nothing to do)
 * and throws on malformed markers, mirroring upsertMarkedBlock.
 */
export function removeMarkedBlock(
  current: string,
  name: string,
): string | null {
  const at = locateMarkedBlock(current, name);
  if (at === null) return null;
  const { end } = agentsMarkers(name);
  const before = current.slice(0, at.startAt).trimEnd();
  const after = current.slice(at.endAt + end.length).trim();
  const merged = [before, after].filter(Boolean).join("\n\n");
  return merged === "" ? "" : `${merged}\n`;
}

/** Throw when writing `target` would follow a symlink to land outside `boundary`. */
function assertWriteWithin(
  boundary: string,
  target: string,
  label: string,
): void {
  const boundaryReal = realpathSync(boundary);
  const inside = (p: string) =>
    p === boundaryReal || p.startsWith(boundaryReal + sep);
  let existing = dirname(target);
  while (!existsSync(existing)) existing = dirname(existing);
  let escapes = !inside(realpathSync(existing));
  if (
    !escapes &&
    lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()
  ) {
    try {
      escapes = !inside(realpathSync(target));
    } catch {
      escapes = true;
    }
  }
  if (escapes) {
    throw new UserError(
      `Refusing to write ${label}: it resolves outside the project through a symlink. Remove the symlink, then rerun.`,
    );
  }
}

function upsertAgentsFile(cwd: string, name: string, body: string): string {
  const path = join(cwd, AGENTS_FILE);
  assertWriteWithin(cwd, path, AGENTS_FILE);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  writeFileSync(path, upsertMarkedBlock(current, name, body));
  return AGENTS_FILE;
}

/** Write the skill's files under `root`, returning their slash-separated relative paths. */
function writeSkillFiles(
  root: string,
  skill: ProjectSkill,
  boundary?: string,
): string[] {
  const relPaths = Object.keys(skill.files);
  for (const relPath of relPaths) {
    const target = join(root, relPath);
    if (boundary) assertWriteWithin(boundary, target, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, skill.files[relPath] as string);
  }
  return relPaths;
}

/**
 * Install or update a skill in the current project.
 *
 * Always maintains a marked block in AGENTS.md; additionally writes the skill
 * files under .claude/skills/<name>/ when the project already uses Claude Code.
 * Returns the written paths relative to `cwd`, slash-separated for display.
 * Idempotent: reruns refresh the same files. Refuses any write that a symlink
 * would redirect outside the project, so a checkout can't plant links that
 * make the installer overwrite unrelated files.
 */
export function installProjectSkill(
  cwd: string,
  skill: ProjectSkill,
): string[] {
  const written: string[] = [
    upsertAgentsFile(cwd, skill.name, skill.agentsSection),
  ];
  if (usesClaude(cwd)) {
    const skillRoot = `.claude/skills/${skill.name}`;
    for (const relPath of writeSkillFiles(join(cwd, skillRoot), skill, cwd)) {
      written.push(`${skillRoot}/${relPath}`);
    }
  }
  return written;
}

/**
 * Remove a skill from the current project.
 *
 * Strips the marked block from AGENTS.md (deleting the file when only the
 * installer's own scaffold heading would remain) and deletes
 * .claude/skills/<name>/. Returns the paths it changed relative to `cwd`,
 * empty when nothing was installed. Symlink-guarded like the install path.
 */
export function removeProjectSkill(cwd: string, name: string): string[] {
  const removed: string[] = [];
  const path = join(cwd, AGENTS_FILE);
  if (existsSync(path)) {
    assertWriteWithin(cwd, path, AGENTS_FILE);
    const updated = removeMarkedBlock(readFileSync(path, "utf8"), name);
    if (updated !== null) {
      if (updated === "" || updated.trim() === DEFAULT_AGENTS_HEADING) {
        rmSync(path);
      } else {
        writeFileSync(path, updated);
      }
      removed.push(AGENTS_FILE);
    }
  }
  const skillRoot = `.claude/skills/${name}`;
  const dir = join(cwd, skillRoot);
  if (existsSync(dir)) {
    assertWriteWithin(cwd, dir, skillRoot);
    rmSync(dir, { recursive: true, force: true });
    removed.push(skillRoot);
  }
  return removed;
}

/** Global skill roots: the cross-tool .agents standard plus Claude Code's own dir. */
function globalSkillRoots(home: string, name: string): string[] {
  return [
    join(home, ".agents/skills", name),
    join(home, ".claude/skills", name),
  ];
}

/**
 * Install or update a skill globally for the current user.
 *
 * Writes the skill files under ~/.agents/skills/<name>/ (the cross-tool
 * directory read by Cursor, Codex, OpenCode, Copilot, and others) and
 * ~/.claude/skills/<name>/ so every project picks it up. Returns the
 * absolute paths written.
 */
export function installGlobalSkill(
  skill: ProjectSkill,
  home = homedir(),
): string[] {
  const written: string[] = [];
  for (const root of globalSkillRoots(home, skill.name)) {
    for (const relPath of writeSkillFiles(root, skill)) {
      written.push(join(root, relPath));
    }
  }
  return written;
}

/**
 * Remove a globally installed skill from every global root.
 *
 * Returns the absolute directories deleted, empty when none existed.
 */
export function removeGlobalSkill(name: string, home = homedir()): string[] {
  const removed: string[] = [];
  for (const root of globalSkillRoots(home, name)) {
    if (!existsSync(root)) continue;
    rmSync(root, { recursive: true, force: true });
    removed.push(root);
  }
  return removed;
}
