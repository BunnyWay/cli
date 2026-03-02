import prompts from "prompts";
import ora from "ora";

/**
 * Masked password input. Returns an empty string if the user cancels.
 *
 * For non-interactive/agent usage, commands should accept a flag
 * (e.g. `--api-key`) that bypasses this prompt entirely.
 */
export async function readPassword(message: string): Promise<string> {
  const { value } = await prompts({
    type: "password",
    name: "value",
    message,
  });
  return value ?? "";
}

/**
 * Confirmation prompt. Returns `false` if the user declines or cancels.
 *
 * Pass `opts.force` to skip the prompt and return `true` immediately.
 * All commands with confirmations should expose a `--force` flag
 * so agents and scripts can run non-interactively.
 */
export async function confirm(
  message: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  if (opts?.force) return true;
  const { confirmed } = await prompts({
    type: "confirm",
    name: "confirmed",
    message,
    initial: false,
  });
  return confirmed ?? false;
}

/** Creates an ora spinner. Automatically silenced in non-TTY environments. */
export function spinner(text: string) {
  return ora({ text, isSilent: !process.stdout.isTTY });
}

/** Open a URL in the user's default browser. */
export function openBrowser(url: string) {
  const cmds: Record<string, string[]> = {
    darwin: ["open", url],
    linux: ["xdg-open", url],
    win32: ["rundll32", "url.dll,FileProtocolHandler", url],
  };

  const args = cmds[process.platform];
  if (args) {
    Bun.spawn(args, { stdio: ["ignore", "ignore", "ignore"] });
  }
}
