import * as clack from "@clack/prompts";
import { bunny } from "./colors.ts";
import { UserError } from "./errors.ts";
import { logger } from "./logger.ts";

// Prompts and spinners render on stderr so a piped stdout only ever carries command output.
const output = process.stderr;

export interface PromptChoice {
  title: string;
  value: unknown;
  description?: string;
  disabled?: boolean;
  selected?: boolean;
}

export interface PromptQuestion<N extends string = string> {
  type:
    | "text"
    | "number"
    | "select"
    | "multiselect"
    | "confirm"
    | "toggle"
    | "password";
  name: N;
  message: string;
  /** Prefilled value; for `select` it is the index of the preselected choice. */
  initial?: unknown;
  choices?: PromptChoice[];
  validate?: (value: any) => boolean | string;
  active?: string;
  inactive?: string;
  /** Accepted for source compatibility; the prompt renders its own key hints. */
  hint?: string;
  instructions?: boolean;
}

export type PromptAnswers<N extends string> = Record<N, any>;

let stdinEnded = false;
let eofWarned = false;

// Answers queued by tests; an Error entry cancels the prompt and `undefined` takes the question's initial value.
const injected: unknown[] = [];
const INJECTED_CANCEL = Symbol("injected cancel");

function isCancelled(value: unknown): boolean {
  return value === INJECTED_CANCEL || clack.isCancel(value);
}

// Destroying stdin stops the library's keypress listener; the escape code re-shows the cursor in case a prompt already hid it.
function abortUnanswerablePrompt(): null {
  process.stdin.destroy();
  if (!eofWarned) {
    eofWarned = true;
    output.write(output.isTTY ? "\x1b[?25h\n" : "\n");
    logger.warn(
      "Can't prompt: stdin is not an interactive terminal. Pass values as flags, or --force to skip confirmations.",
    );
  }
  return null;
}

// Prompts require an interactive terminal: piped stdin is refused up front, and the EOF race below is a backstop for a terminal that hangs up mid-prompt, where the library would otherwise wait on the dead stream forever. The null result maps to "cancelled" at each call site.
async function promptOrEof<T>(run: () => Promise<T>): Promise<T | null> {
  if (
    injected.length === 0 &&
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

function toOption(choice: PromptChoice) {
  return {
    value: choice.value,
    label: choice.title,
    hint: choice.description,
    disabled: choice.disabled,
  };
}

// The library reads `true` as valid and a string as the error; clack wants `undefined` for valid.
function toValidate(validate?: PromptQuestion["validate"]) {
  if (!validate) return undefined;
  return (value: string | undefined) => {
    const result = validate(value ?? "");
    if (result === true) return undefined;
    return result === false ? "Invalid value." : result;
  };
}

function initialFor(q: PromptQuestion): unknown {
  if (q.type === "select")
    return typeof q.initial === "number"
      ? q.choices?.[q.initial]?.value
      : undefined;
  if (q.type === "multiselect")
    return (q.choices ?? []).filter((c) => c.selected).map((c) => c.value);
  return q.initial;
}

// Runs one question through the matching clack prompt; the result is the answer or a cancel symbol (see isCancelled).
async function ask(q: PromptQuestion): Promise<unknown> {
  if (injected.length > 0) {
    const next = injected.shift();
    if (next instanceof Error) return INJECTED_CANCEL;
    return next === undefined ? initialFor(q) : next;
  }
  const message = q.message;
  switch (q.type) {
    case "text":
      return clack.text({
        output,
        message,
        initialValue: q.initial === undefined ? undefined : String(q.initial),
        validate: toValidate(q.validate),
      });
    case "password":
      return clack.password({
        output,
        message,
        validate: toValidate(q.validate),
      });
    case "number": {
      const answer = await clack.text({
        output,
        message,
        initialValue: q.initial === undefined ? undefined : String(q.initial),
        validate: (value) =>
          !value || Number.isFinite(Number(value))
            ? undefined
            : "Enter a number.",
      });
      if (clack.isCancel(answer)) return answer;
      return answer === "" ? q.initial : Number(answer);
    }
    case "confirm":
    case "toggle":
      return clack.confirm({
        output,
        message,
        initialValue: Boolean(q.initial ?? false),
        active: q.active,
        inactive: q.inactive,
      });
    case "select":
      return clack.select({
        output,
        message,
        options: (q.choices ?? []).map(toOption),
        initialValue: initialFor(q),
      });
    case "multiselect":
      return clack.multiselect({
        output,
        message,
        options: (q.choices ?? []).map(toOption),
        initialValues: initialFor(q) as unknown[],
        required: false,
      });
  }
}

/**
 * Terminal-safe question runner with the shape of the old `prompts` library,
 * rendered by `@clack/prompts`. Asks each question in turn and returns the
 * answers keyed by `name`. Cancelling (Ctrl-C) stops at that question, so
 * the missing answers surface as `undefined`. When stdin cannot answer (not a
 * terminal, closed, `< /dev/null`) it returns `{}` without prompting.
 */
export async function prompts<N extends string = string>(
  questions: PromptQuestion<N> | Array<PromptQuestion<N>>,
  options?: { onCancel?: () => boolean | undefined },
): Promise<PromptAnswers<N>> {
  const list = Array.isArray(questions) ? questions : [questions];
  const result = await promptOrEof(async () => {
    const answers = {} as PromptAnswers<N>;
    for (const q of list) {
      const answer = await ask(q);
      if (isCancelled(answer)) {
        if (options?.onCancel?.() === true) continue;
        break;
      }
      answers[q.name] = answer;
    }
    return answers;
  });
  return result ?? ({} as PromptAnswers<N>);
}

/** Queue answers for upcoming prompts in tests; an Error entry cancels its prompt. */
prompts.inject = (answers: unknown[]): void => {
  injected.push(...answers);
};

/**
 * Masked password input. Returns an empty string if the user cancels.
 *
 * For non-interactive/agent usage, commands should accept a flag
 * (e.g. `--api-key`) that bypasses this prompt entirely.
 */
export async function readPassword(message: string): Promise<string> {
  const result = await promptOrEof(() =>
    ask({ type: "password", name: "value", message }),
  );
  return result === null || isCancelled(result) ? "" : String(result);
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
    ask({
      type: "confirm",
      name: "confirmed",
      message,
      initial: opts?.initial ?? false,
    }),
  );
  if (result === null && !opts?.optional) throw stdinClosedError();
  return result === true;
}

/** Like confirm, but reports Ctrl-C as "cancel" instead of folding it into "no". */
export async function confirmOrCancel(
  message: string,
  opts?: { initial?: boolean },
): Promise<"yes" | "no" | "cancel"> {
  const result = await promptOrEof(() =>
    ask({
      type: "confirm",
      name: "confirmed",
      message,
      initial: opts?.initial ?? false,
    }),
  );
  if (result === null || isCancelled(result)) return "cancel";
  return result === true ? "yes" : "no";
}

export async function confirmTyped(
  expected: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  if (opts?.force) return true;
  const result = await promptOrEof(() =>
    ask({
      type: "text",
      name: "value",
      message: `Type "${expected}" to confirm:`,
    }),
  );
  if (result === null) throw stdinClosedError();
  return result === expected;
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

export interface Spinner {
  text: string;
  start(): Spinner;
  stop(): Spinner;
}

/** Creates a spinner on stderr. Silent unless both stdout and stderr are terminals; `stop()` clears it without leaving a line behind. */
export function spinner(text: string): Spinner {
  const silent = !process.stdout.isTTY || !output.isTTY;
  let current = text;
  let active = false;
  // A real SIGINT only reaches clack's onCancel; exit 130 there so the command still ends.
  const spin = clack.spinner({
    output,
    withGuide: false,
    styleFrame: (frame) => bunny(frame),
    onCancel: () => process.exit(130),
  });
  // stdin is in raw mode while a spinner runs, so Ctrl-C arrives as a keypress that clack answers with exit code 0; step in first so an `&&` chain still stops.
  const onKeypress = (key: string | undefined) => {
    if (key !== "\x03") return;
    spin.cancel("Cancelled.");
    process.exit(130);
  };
  const api: Spinner = {
    get text() {
      return current;
    },
    set text(value: string) {
      current = value;
      if (active) spin.message(value);
    },
    start() {
      if (!silent && !active) {
        process.stdin.on("keypress", onKeypress);
        spin.start(current);
        active = true;
      }
      return api;
    },
    stop() {
      if (active) {
        spin.clear();
        process.stdin.off("keypress", onKeypress);
        active = false;
      }
      return api;
    },
  };
  return api;
}

/** Run `fn` under a started spinner, stopping it whatever happens; `fn` may update `spin.text`. */
export async function withSpinner<T>(
  text: string,
  fn: (spin: Spinner) => Promise<T>,
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
