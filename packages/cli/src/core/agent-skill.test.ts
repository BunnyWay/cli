import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENTS_FILE,
  agentsMarkers,
  installGlobalSkill,
  installProjectSkill,
  isGlobalSkillInstalled,
  isProjectSkillInstalled,
  type ProjectSkill,
  removeGlobalSkill,
  removeMarkedBlock,
  removeProjectSkill,
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

  test("throws on malformed markers instead of corrupting the file", () => {
    const malformed = [
      `${start}\nno end`,
      `no start\n${end}`,
      `${end}\nmiddle\n${start}`,
      `${start}\nold\n${start}\nkeep me\n${end}`,
      `${start}\nold\n${end}\nkeep me\n${end}`,
    ];
    for (const content of malformed) {
      expect(() => upsertMarkedBlock(content, "bunny-test", "body")).toThrow(
        "malformed bunny-test block",
      );
    }
  });
});

describe("installProjectSkill", () => {
  test("creates AGENTS.md with a marked block when missing", () => {
    const files = installProjectSkill(cwd, SKILL);
    expect(files[0]).toBe(AGENTS_FILE);
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

  test("writes the full skill to .agents/skills", () => {
    expect(installProjectSkill(cwd, SKILL)).toEqual([
      AGENTS_FILE,
      ".agents/skills/bunny-test/references/extra.md",
      ".agents/skills/bunny-test/SKILL.md",
    ]);
    expect(
      readFileSync(join(cwd, ".agents/skills/bunny-test/SKILL.md"), "utf8"),
    ).toContain("name: bunny-test");
  });

  test("adds .claude/skills on top when .claude/ exists", () => {
    mkdirSync(join(cwd, ".claude"));
    expect(installProjectSkill(cwd, SKILL)).toEqual([
      AGENTS_FILE,
      ".agents/skills/bunny-test/references/extra.md",
      ".agents/skills/bunny-test/SKILL.md",
      ".claude/skills/bunny-test/references/extra.md",
      ".claude/skills/bunny-test/SKILL.md",
    ]);
  });

  test("refuses to install into the filesystem root", () => {
    expect(() => installProjectSkill("/", SKILL)).toThrow(
      "Refusing to install into the filesystem root",
    );
  });

  test("refuses to install into the home directory", () => {
    expect(() => installProjectSkill(cwd, SKILL, cwd)).toThrow(
      "Refusing to install into your home directory",
    );
    expect(readdirSync(cwd)).toEqual([]);
  });

  test("writes skill files when CLAUDE.md exists", () => {
    writeFileSync(join(cwd, "CLAUDE.md"), "# Claude\n");
    const files = installProjectSkill(cwd, SKILL);
    expect(files).toContain(".claude/skills/bunny-test/SKILL.md");
  });

  test("refuses an AGENTS.md symlink that points outside the project", () => {
    const outside = join(cwd, "..", `bunny-agent-skill-outside-${Date.now()}`);
    writeFileSync(outside, "precious\n");
    try {
      symlinkSync(outside, join(cwd, AGENTS_FILE));
      expect(() => installProjectSkill(cwd, SKILL)).toThrow(
        "resolves outside the project",
      );
      expect(readFileSync(outside, "utf8")).toBe("precious\n");
    } finally {
      rmSync(outside, { force: true });
    }
  });

  test("follows an AGENTS.md symlink that stays inside the project", () => {
    writeFileSync(join(cwd, "CLAUDE.md"), "# Claude\n");
    symlinkSync(join(cwd, "CLAUDE.md"), join(cwd, AGENTS_FILE));
    installProjectSkill(cwd, SKILL);
    expect(readFileSync(join(cwd, "CLAUDE.md"), "utf8")).toContain(
      agentsMarkers("bunny-test").start,
    );
  });

  // Planting a SKILL.md outside proves the boundary check runs before the sentinel delete, not just before the writes.
  test.each([
    ".agents",
    ".claude",
  ])("refuses skill writes when %s/skills escapes via a symlink", (parent) => {
    const outside = mkdtempSync(join(tmpdir(), "bunny-agent-skill-escape-"));
    const planted = join(outside, "bunny-test/SKILL.md");
    try {
      mkdirSync(join(outside, "bunny-test"));
      writeFileSync(planted, "precious\n");
      mkdirSync(join(cwd, parent));
      symlinkSync(outside, join(cwd, parent, "skills"));
      expect(() => installProjectSkill(cwd, SKILL)).toThrow(
        "resolves outside the project",
      );
      expect(readFileSync(planted, "utf8")).toBe("precious\n");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("installGlobalSkill", () => {
  test("writes skill files under the home .agents/skills and .claude/skills dirs", () => {
    expect(isGlobalSkillInstalled("bunny-test", cwd)).toBe(false);
    const files = installGlobalSkill(SKILL, cwd);
    expect(files).toEqual([
      join(cwd, ".agents/skills/bunny-test/references/extra.md"),
      join(cwd, ".agents/skills/bunny-test/SKILL.md"),
      join(cwd, ".claude/skills/bunny-test/references/extra.md"),
      join(cwd, ".claude/skills/bunny-test/SKILL.md"),
    ]);
    for (const file of files) expect(existsSync(file)).toBe(true);
    expect(existsSync(join(cwd, AGENTS_FILE))).toBe(false);
    expect(isGlobalSkillInstalled("bunny-test", cwd)).toBe(true);
    // A missing root means a partial install, which must count as not installed so it re-offers.
    rmSync(join(cwd, ".agents"), { recursive: true, force: true });
    expect(isGlobalSkillInstalled("bunny-test", cwd)).toBe(false);
  });

  test("a failed refresh clears the completion sentinel so it counts as not installed", () => {
    installGlobalSkill(SKILL, cwd);
    const conflict = join(cwd, ".claude/skills/bunny-test/references/extra.md");
    rmSync(conflict);
    // A directory where a file belongs makes the refresh fail mid-write.
    mkdirSync(conflict);
    expect(() => installGlobalSkill(SKILL, cwd)).toThrow();
    expect(existsSync(join(cwd, ".claude/skills/bunny-test/SKILL.md"))).toBe(
      false,
    );
    expect(isGlobalSkillInstalled("bunny-test", cwd)).toBe(false);
  });
});

describe("removeMarkedBlock", () => {
  const { start, end } = agentsMarkers("bunny-test");

  test("removes the block, collapsing whitespace; null when absent, empty when the block was the whole file", () => {
    const content = `intro\n\n${start}\n\nbody\n\n${end}\n\noutro\n`;
    expect(removeMarkedBlock(content, "bunny-test")).toBe("intro\n\noutro\n");
    expect(removeMarkedBlock("# Mine\n", "bunny-test")).toBeNull();
    expect(
      removeMarkedBlock(`${start}\n\nbody\n\n${end}\n`, "bunny-test"),
    ).toBe("");
  });

  test("throws on malformed markers like upsert does", () => {
    expect(() => removeMarkedBlock(`${start}\nno end`, "bunny-test")).toThrow(
      "malformed bunny-test block",
    );
  });
});

describe("removeProjectSkill", () => {
  test("returns nothing when the skill was never installed", () => {
    expect(removeProjectSkill(cwd, "bunny-test")).toEqual([]);
  });

  test("strips the block, keeps the user's content, and deletes skill files", () => {
    writeFileSync(join(cwd, AGENTS_FILE), "# My project\n\nUse tabs.\n");
    mkdirSync(join(cwd, ".claude"));
    installProjectSkill(cwd, SKILL);
    const removed = removeProjectSkill(cwd, "bunny-test");
    expect(removed).toEqual([
      AGENTS_FILE,
      ".agents/skills/bunny-test",
      ".claude/skills/bunny-test",
    ]);
    const content = readFileSync(join(cwd, AGENTS_FILE), "utf8");
    expect(content).toContain("Use tabs.");
    expect(content).not.toContain(agentsMarkers("bunny-test").start);
    expect(existsSync(join(cwd, ".claude/skills/bunny-test"))).toBe(false);
  });

  test("deletes an AGENTS.md the installer created from scratch", () => {
    installProjectSkill(cwd, SKILL);
    removeProjectSkill(cwd, "bunny-test");
    expect(existsSync(join(cwd, AGENTS_FILE))).toBe(false);
  });

  test("leaves other skills' blocks in place", () => {
    installProjectSkill(cwd, SKILL);
    installProjectSkill(cwd, {
      name: "bunny-other",
      agentsSection: "## Other\n\nOther guidance.",
      files: {},
    });
    removeProjectSkill(cwd, "bunny-test");
    const content = readFileSync(join(cwd, AGENTS_FILE), "utf8");
    expect(content).not.toContain(agentsMarkers("bunny-test").start);
    expect(content).toContain(agentsMarkers("bunny-other").start);
  });
  test("in the home directory strips AGENTS.md but leaves the global skill dirs", () => {
    installGlobalSkill(SKILL, cwd);
    writeFileSync(
      join(cwd, AGENTS_FILE),
      upsertMarkedBlock(null, "bunny-test", SKILL.agentsSection),
    );
    const removed = removeProjectSkill(cwd, "bunny-test", cwd);
    expect(removed).toEqual([AGENTS_FILE]);
    expect(isGlobalSkillInstalled("bunny-test", cwd)).toBe(true);
  });
});

describe("removeGlobalSkill", () => {
  test("removes the skill from every global root; nothing left for a second call", () => {
    installGlobalSkill(SKILL, cwd);
    const removed = removeGlobalSkill("bunny-test", cwd);
    expect(removed).toEqual([
      join(cwd, ".agents/skills/bunny-test"),
      join(cwd, ".claude/skills/bunny-test"),
    ]);
    for (const dir of removed) expect(existsSync(dir)).toBe(false);
    expect(removeGlobalSkill("bunny-test", cwd)).toEqual([]);
  });
});

describe("isProjectSkillInstalled", () => {
  test("false without AGENTS.md or marker, true after install, scoped by name", () => {
    expect(isProjectSkillInstalled(cwd, "bunny-test")).toBe(false);
    writeFileSync(join(cwd, AGENTS_FILE), "# My project\n");
    expect(isProjectSkillInstalled(cwd, "bunny-test")).toBe(false);
    installProjectSkill(cwd, SKILL);
    expect(isProjectSkillInstalled(cwd, "bunny-test")).toBe(true);
    expect(isProjectSkillInstalled(cwd, "bunny-other")).toBe(false);
  });
});

describe("usesClaude", () => {
  test("false in a bare project, true with .claude/", () => {
    expect(usesClaude(cwd)).toBe(false);
    mkdirSync(join(cwd, ".claude"));
    expect(usesClaude(cwd)).toBe(true);
  });
});
