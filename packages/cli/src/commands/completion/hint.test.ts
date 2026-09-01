import { describe, expect, test } from "bun:test";
import { completionHint } from "./hint.ts";

describe("completionHint", () => {
  test("names the rc file and line for zsh, bash, and fish", () => {
    expect(completionHint("/bin/zsh")).toBe(
      "Tip: enable shell completions by adding `source <(bunny completion)` to ~/.zshrc.",
    );
    expect(completionHint("/usr/local/bin/bash")).toBe(
      "Tip: enable shell completions by adding `source <(bunny completion)` to ~/.bashrc.",
    );
    expect(completionHint("/usr/local/bin/fish")).toBe(
      "Tip: enable fish completions with: `mkdir -p ~/.config/fish/completions && bunny completion > ~/.config/fish/completions/bunny.fish`.",
    );
  });

  test("falls back to the bash form for other or missing shells", () => {
    for (const shell of ["/usr/bin/shelby", undefined, ""]) {
      expect(completionHint(shell)).toBe(
        "Tip: enable shell completions by adding `source <(bunny completion)` to ~/.bashrc.",
      );
    }
  });
});
