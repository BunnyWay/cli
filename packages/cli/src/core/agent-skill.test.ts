import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENTS_FILE,
  agentsMarkers,
  installGlobalSkill,
  installProjectSkill,
  isProjectSkillInstalled,
  type ProjectSkill,
  upsertMarkedBlock,
  usesClaude,
} from "./agent-skill.ts";

const SKILL: ProjectSkill = {
  name: "bunny-test",
  agentsSection: "## Test skill\n\nUse `bunny test` for testing.",
  files: {
    "SKILL.md": "---\nname: bunny-test\n---\n\n# Test\n",
    "references/extra.md": "# Extra\n",
  },
};

let cwd: string;

beforeEach(() => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "bunny-agent-skill-")));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("upsertMarkedBlock", () => {
  const { start, end } = agentsMarkers("bunny-test");

  test("null starts a fresh file with a heading", () => {
    const result = upsertMarkedBlock(null, "bunny-test", "body");
    expect(result.startsWith("# Agent instructions\n")).toBe(true);
    expect(result).toContain(`${start}\n\nbody\n\n${end}`);
  });

  test("appends when no markers exist, preserving content", () => {
    const result = upsertMarkedBlock("# Mine\n", "bunny-test", "body");
    expect(result.startsWith("# Mine\n")).toBe(true);
    expect(result.endsWith(`${end}\n`)).toBe(true);
  });

  test("replaces a well-formed block in place", () => {
    const before = `intro\n\n${start}\n\nold\n\n${end}\n\noutro\n`;
    const result = upsertMarkedBlock(before, "bunny-test", "new");
    expect(result).toBe(`intro\n\n${start}\n\nnew\n\n${end}\n\noutro\n`);
  });

  test("throws on a missing end marker instead of corrupting the file", () => {
    expect(() =>
      upsertMarkedBlock(`${start}\nno end`, "bunny-test", "body"),
    ).toThrow("malformed bunny-test block");
  });

  test("throws on a missing start marker", () => {
    expect(() =>
      upsertMarkedBlock(`no start\n${end}`, "bunny-test", "body"),
    ).toThrow("malformed bunny-test block");
  });

  test("throws when end precedes start", () => {
    expect(() =>
      upsertMarkedBlock(`${end}\nmiddle\n${start}`, "bunny-test", "body"),
    ).toThrow("malformed bunny-test block");
  });
});

describe("installProjectSkill", () => {
  test("creates AGENTS.md with a marked block when missing", () => {
    const files = installProjectSkill(cwd, SKILL);
    expect(files).toEqual([AGENTS_FILE]);
    const content = readFileSync(join(cwd, AGENTS_FILE), "utf8");
    expect(content).toContain(agentsMarkers("bunny-test").start);
    expect(content).toContain("Use `bunny test` for testing.");
  });

  test("appends to an existing AGENTS.md without touching its content", () => {
    writeFileSync(join(cwd, AGENTS_FILE), "# My project\n\nUse tabs.\n");
    installProjectSkill(cwd, SKILL);
    const content = readFileSync(join(cwd, AGENTS_FILE), "utf8");
    expect(content.startsWith("# My project\n\nUse tabs.\n")).toBe(true);
    expect(content).toContain(agentsMarkers("bunny-test").start);
  });

  test("reinstall replaces the marked block instead of duplicating it", () => {
    installProjectSkill(cwd, SKILL);
    installProjectSkill(cwd, {
      ...SKILL,
      agentsSection: "## Test skill\n\nUpdated guidance.",
    });
    const content = readFileSync(join(cwd, AGENTS_FILE), "utf8");
    expect(content.split(agentsMarkers("bunny-test").start).length).toBe(2);
    expect(content).toContain("Updated guidance.");
    expect(content).not.toContain("Use `bunny test` for testing.");
  });

  test("two skills coexist in one AGENTS.md", () => {
    installProjectSkill(cwd, SKILL);
    installProjectSkill(cwd, {
      name: "bunny-other",
      agentsSection: "## Other\n\nOther guidance.",
      files: {},
    });
    const content = readFileSync(join(cwd, AGENTS_FILE), "utf8");
    expect(content).toContain(agentsMarkers("bunny-test").start);
    expect(content).toContain(agentsMarkers("bunny-other").start);
  });

  test("skips .claude/skills when the project does not use Claude", () => {
    installProjectSkill(cwd, SKILL);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  test("writes all skill files when .claude/ exists", () => {
    mkdirSync(join(cwd, ".claude"));
    const files = installProjectSkill(cwd, SKILL);
    expect(files).toEqual([
      AGENTS_FILE,
      ".claude/skills/bunny-test/SKILL.md",
      ".claude/skills/bunny-test/references/extra.md",
    ]);
    const skill = readFileSync(
      join(cwd, ".claude/skills/bunny-test/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("name: bunny-test");
  });

  test("writes skill files when CLAUDE.md exists", () => {
    writeFileSync(join(cwd, "CLAUDE.md"), "# Claude\n");
    const files = installProjectSkill(cwd, SKILL);
    expect(files).toContain(".claude/skills/bunny-test/SKILL.md");
  });
});

describe("installGlobalSkill", () => {
  test("writes skill files under the home .claude/skills dir", () => {
    const files = installGlobalSkill(SKILL, cwd);
    expect(files).toEqual([
      join(cwd, ".claude/skills/bunny-test/SKILL.md"),
      join(cwd, ".claude/skills/bunny-test/references/extra.md"),
    ]);
    expect(existsSync(files[0] as string)).toBe(true);
    expect(existsSync(join(cwd, AGENTS_FILE))).toBe(false);
  });
});

describe("isProjectSkillInstalled", () => {
  test("false without AGENTS.md", () => {
    expect(isProjectSkillInstalled(cwd, "bunny-test")).toBe(false);
  });

  test("false when AGENTS.md lacks the marker", () => {
    writeFileSync(join(cwd, AGENTS_FILE), "# My project\n");
    expect(isProjectSkillInstalled(cwd, "bunny-test")).toBe(false);
  });

  test("true after install, scoped by name", () => {
    installProjectSkill(cwd, SKILL);
    expect(isProjectSkillInstalled(cwd, "bunny-test")).toBe(true);
    expect(isProjectSkillInstalled(cwd, "bunny-other")).toBe(false);
  });
});

describe("usesClaude", () => {
  test("false in a bare project", () => {
    expect(usesClaude(cwd)).toBe(false);
  });

  test("true with .claude/ or CLAUDE.md", () => {
    mkdirSync(join(cwd, ".claude"));
    expect(usesClaude(cwd)).toBe(true);
  });
});
