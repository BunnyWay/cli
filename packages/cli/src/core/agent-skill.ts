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

/** Return `current` with the named block created, appended, or replaced in place; malformed markers throw instead of guessing. */
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

/** Return `current` without the named block and the whitespace it occupied, or null when no block is present. */
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
  for (const [relPath, contents] of Object.entries(skill.files)) {
    const target = join(root, relPath);
    if (boundary) assertWriteWithin(boundary, target, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return Object.keys(skill.files);
}

/** Install or update a skill in the project (AGENTS.md block always, .claude/skills/<name>/ when the project uses Claude Code), returning the cwd-relative paths written. */
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

/** Undo installProjectSkill: strip the AGENTS.md block (deleting the file when only the scaffold heading remains) and delete .claude/skills/<name>/, returning the changed paths. */
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

/** Install or update a skill under every global root so AI coding tools pick it up in every project, returning the absolute paths written. */
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

/** True when the named skill is already installed in any global root. */
export function isGlobalSkillInstalled(
  name: string,
  home = homedir(),
): boolean {
  return globalSkillRoots(home, name).some((root) =>
    existsSync(join(root, "SKILL.md")),
  );
}

/** Delete a skill from every global root, returning the directories removed. */
export function removeGlobalSkill(name: string, home = homedir()): string[] {
  const removed: string[] = [];
  for (const root of globalSkillRoots(home, name)) {
    if (!existsSync(root)) continue;
    rmSync(root, { recursive: true, force: true });
    removed.push(root);
  }
  return removed;
}
