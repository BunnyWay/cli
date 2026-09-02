import { describe, expect, test } from "bun:test";
import { BUNNY_CLI_SKILL } from "./content.ts";

describe("BUNNY_CLI_SKILL", () => {
  test("embeds the shipped SKILL.md with its frontmatter", () => {
    const skill = BUNNY_CLI_SKILL.files["SKILL.md"];
    expect(skill).toStartWith("---\nname: bunny-cli\n");
    expect(skill).toContain("bunny login");
  });

  test("embeds every reference the SKILL.md decision tree points at", () => {
    const skill = BUNNY_CLI_SKILL.files["SKILL.md"] as string;
    const referenced = [...skill.matchAll(/references\/[a-z-]+\.md/g)].map(
      (m) => m[0],
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const ref of referenced) {
      expect(BUNNY_CLI_SKILL.files[ref]).toBeDefined();
      expect((BUNNY_CLI_SKILL.files[ref] as string).length).toBeGreaterThan(0);
    }
  });

  test("agents section is compact and self-contained", () => {
    expect(BUNNY_CLI_SKILL.agentsSection).toContain("bunny login");
    expect(BUNNY_CLI_SKILL.agentsSection).toContain("--output json");
    expect(BUNNY_CLI_SKILL.agentsSection.split("\n").length).toBeLessThan(20);
  });

  test("documents the storage namespace and the database client", () => {
    const storage = BUNNY_CLI_SKILL.files["references/storage.md"] as string;
    expect(storage).toContain("bunny storage zones add");
    expect(storage).toContain("bunny storage files upload");

    const client = BUNNY_CLI_SKILL.files[
      "references/database-client.md"
    ] as string;
    expect(client).toContain("@bunny.net/database-client");
    expect(client).toContain("Critical: server-side only");
  });

  test("does not reference experimental namespaces hidden from help", () => {
    const texts = [
      BUNNY_CLI_SKILL.agentsSection,
      ...Object.values(BUNNY_CLI_SKILL.files),
    ];
    for (const namespace of [
      "bunny apps",
      "bunny registries",
      "bunny registry",
    ]) {
      for (const text of texts) expect(text).not.toContain(namespace);
    }
  });
});
