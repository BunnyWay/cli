import ora from "ora";
import prompts from "prompts";
import { UserError } from "./errors.ts";

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
  opts?: { force?: boolean; initial?: boolean },
): Promise<boolean> {
  if (opts?.force) return true;
  const { confirmed } = await prompts({
    type: "confirm",
    name: "confirmed",
    message,
    initial: opts?.initial ?? false,
  });
  return confirmed ?? false;
}

export async function confirmTyped(
  expected: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  if (opts?.force) return true;
  const { value } = await prompts({
    type: "text",
    name: "value",
    message: `Type "${expected}" to confirm:`,
  });
  return value === expected;
}

export function isInteractive(output?: string): boolean {
  return (
    output !== "json" &&
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY)
  );
}

// Guard a confirmation there's nobody to answer: an unguarded prompt blocks forever in CI and lands on stdout ahead of `--output json`, so unattended runs must pass --force.
export function requireConfirmable(
  output: string | undefined,
  opts: { force?: boolean; message: string; hint: string },
): void {
  if (opts.force || isInteractive(output)) return;
  throw new UserError(opts.message, opts.hint);
}

/** Creates an ora spinner. Automatically silenced in non-TTY environments. */
export function spinner(text: string) {
  return ora({ text, isSilent: !process.stdout.isTTY });
}

/** Run `fn` under a started spinner, stopping it whatever happens; `fn` may update `spin.text`. */
export async function withSpinner<T>(
  text: string,
  fn: (spin: ReturnType<typeof spinner>) => Promise<T>,
): Promise<T> {
  const spin = spinner(text);
  spin.start();
  try {
    return await fn(spin);
  } finally {
    spin.stop();
  }
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
