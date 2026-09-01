import { basename } from "node:path";
import { logger } from "../../core/logger.ts";

/** The rc-file line that wires completions into zsh/bash. */
const PROCESS_SUB_LINE = "source <(bunny completion)";

const SHELL_HINTS: Record<string, string> = {
  zsh: `Tip: enable shell completions by adding \`${PROCESS_SUB_LINE}\` to ~/.zshrc.`,
  bash: `Tip: enable shell completions by adding \`${PROCESS_SUB_LINE}\` to ~/.bashrc.`,
  // Fish lazy-loads completion files from this directory. Alternative would be: appending it to ~/.config/fish/config.fish.
  fish: "Tip: enable fish completions with: `mkdir -p ~/.config/fish/completions && bunny completion > ~/.config/fish/completions/bunny.fish`.",
};

/** The one-line completion tip for the given `$SHELL` value; `undefined` when the shell is unknown. */
export function completionHint(shell: string): string | undefined {
  return SHELL_HINTS[basename(shell)]
}

/** Passive one-line completion hint shown after `bunny login`; suppressed under `--output json` and for unknown shells. */
export function hintShellCompletion(
  output?: string,
  shell: string | undefined = process.env.SHELL,
): void {
  if (output === "json") return;

  if (!shell) return;

  // yargs doesn't support fish shell completions yet until next release.
  // Once https://github.com/yargs/yargs/pull/2569 is merged, remove this check.
  if (shell.includes("fish")) return;

  const hint = completionHint(shell);
  if (hint) logger.dim(hint);
}
