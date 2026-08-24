import ora from "ora";
import promptsLib from "prompts";
import { UserError } from "./errors.ts";
import { logger } from "./logger.ts";

let stdinEnded = false;
let eofWarned = false;

// Destroying stdin stops the library's poll; the escape code re-shows the cursor in case a prompt already hid it.
function abortUnanswerablePrompt(): null {
  process.stdin.destroy();
  if (!eofWarned) {
    eofWarned = true;
    process.stdout.write(process.stdout.isTTY ? "\x1b[?25h\n" : "\n");
    logger.warn(
      "Can't prompt: stdin is not an interactive terminal. Pass values as flags, or --force to skip confirmations.",
    );
  }
  return null;
}

// Injected test answers resolve without touching stdin, so they are exempt from the terminal requirement.
function hasInjectedAnswers(): boolean {
  const injected = (promptsLib as unknown as { _injected?: unknown[] })
    ._injected;
  return (injected?.length ?? 0) > 0;
}

// Prompts require an interactive terminal: piped stdin is refused up front, and the EOF race below is a backstop for a terminal that hangs up mid-prompt, where the prompts library would otherwise busy-poll the dead stream at 100% CPU forever. The null result maps to "cancelled" at each call site.
async function promptOrEof<T extends object>(
  run: () => Promise<T>,
): Promise<T | null> {
  if (
    !hasInjectedAnswers() &&
    (!process.stdin.isTTY ||
      stdinEnded ||
      process.stdin.readableEnded ||
      process.stdin.destroyed)
  ) {
    return abortUnanswerablePrompt();
  }
  let onEnd = () => {};
  const eof = new Promise<null>((resolve) => {
    onEnd = () => {
      stdinEnded = true;
      // Grace period so an answer already in the pipe settles before EOF wins the race; runs at most once per process.
      setTimeout(() => resolve(null), 250);
    };
    process.stdin.once("end", onEnd);
  });
  try {
    const result = await Promise.race([run(), eof]);
    return result === null ? abortUnanswerablePrompt() : result;
  } finally {
    process.stdin.off("end", onEnd);
  }
}

/**
 * Terminal-safe drop-in for the `prompts` library; always use this instead of
 * importing `prompts` directly. Same call shape, but when stdin cannot answer
 * (not a terminal, closed, `< /dev/null`) it returns `{}` without prompting,
 * so missing answers surface as `undefined` exactly like a Ctrl-C cancel.
 */
export async function prompts<T extends string = string>(
  questions: promptsLib.PromptObject<T> | Array<promptsLib.PromptObject<T>>,
  options?: promptsLib.Options,
): Promise<promptsLib.Answers<T>> {
  const result = await promptOrEof(() => promptsLib(questions, options));
  return result ?? ({} as promptsLib.Answers<T>);
}

/**
 * Masked password input. Returns an empty string if the user cancels.
 *
 * For non-interactive/agent usage, commands should accept a flag
 * (e.g. `--api-key`) that bypasses this prompt entirely.
 */
export async function readPassword(message: string): Promise<string> {
  const result = await promptOrEof(() =>
    promptsLib({
      type: "password",
      name: "value",
      message,
    }),
  );
  return result?.value ?? "";
}

// Unanswerable gate confirmations must exit non-zero: agents and CI trust exit codes, and a 0 after "Cancelled." reads as success for work that never happened.
function stdinClosedError(): UserError {
  return new UserError(
    "Confirmation required, but stdin is not an interactive terminal.",
    "Re-run with --force to skip the confirmation.",
  );
}

/**
 * Confirmation prompt. Returns `false` if the user declines or cancels.
 *
 * Pass `opts.force` to skip the prompt and return `true` immediately.
 * All commands with confirmations should expose a `--force` flag
 * so agents and scripts can run non-interactively.
 *
 * When stdin closes before an answer (CI, `< /dev/null`), a gate confirmation
 * throws so the command exits non-zero. Pass `opts.optional` for offer-style
 * prompts where declining is a normal outcome and the command should continue.
 */
export async function confirm(
  message: string,
  opts?: { force?: boolean; initial?: boolean; optional?: boolean },
): Promise<boolean> {
  if (opts?.force) return true;
  const result = await promptOrEof(() =>
    promptsLib({
      type: "confirm",
      name: "confirmed",
      message,
      initial: opts?.initial ?? false,
    }),
  );
  if (result === null && !opts?.optional) throw stdinClosedError();
  return result?.confirmed ?? false;
}

/** Like confirm, but reports Ctrl-C as "cancel" instead of folding it into "no". */
export async function confirmOrCancel(
  message: string,
  opts?: { initial?: boolean },
): Promise<"yes" | "no" | "cancel"> {
  let cancelled = false;
  const result = await promptOrEof(() =>
    promptsLib(
      {
        type: "confirm",
        name: "confirmed",
        message,
        initial: opts?.initial ?? false,
      },
      {
        onCancel: () => {
          cancelled = true;
        },
      },
    ),
  );
  if (result === null || cancelled) return "cancel";
  return result.confirmed ? "yes" : "no";
}

export async function confirmTyped(
  expected: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  if (opts?.force) return true;
  const result = await promptOrEof(() =>
    promptsLib({
      type: "text",
      name: "value",
      message: `Type "${expected}" to confirm:`,
    }),
  );
  if (result === null) throw stdinClosedError();
  return result.value === expected;
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
