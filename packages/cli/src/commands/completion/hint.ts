import { basename } from "node:path";
import { logger } from "@/core/logger.ts";

const SHELL_HINTS: Record<string, string> = {
  zsh: "Tip: enable shell completions with: `bunny completion >> ~/.zshrc`.",
  bash: "Tip: enable shell completions with: `bunny completion >> ~/.bashrc`.",
  // Fish lazy-loads completion files from this directory. Alternative would be: appending it to ~/.config/fish/config.fish.
  fish: "Tip: enable fish completions with: `mkdir -p ~/.config/fish/completions && bunny completion > ~/.config/fish/completions/bunny.fish`.",
};

/** The one-line completion tip for the given `$SHELL` value; `undefined` when the shell is unknown. */
export function completionHint(shell: string): string | undefined {
  return SHELL_HINTS[basename(shell)];
}

/** Passive one-line completion hint shown after `bunny login`; suppressed under `--output json` and for unknown shells. */
export function hintShellCompletion(
  output?: string,
  shell: string | undefined = process.env.SHELL,
): void {
  if (output === "json") return;

  if (!shell) return;

  // yargs emits a fish script from 18.2.0; drop this guard once the repo is on it.
  if (basename(shell) === "fish") return;

  const hint = completionHint(shell);
  if (hint) logger.dim(hint);
}
