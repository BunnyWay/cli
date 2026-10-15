/**
 * Program status reports (OSC 7501).
 *
 * Tells the terminal what the CLI is doing so it can surface it in a tab,
 * sidebar, or notification: working, waiting on the user, finished, failed.
 * The sequence is `ESC ] 7501 ; key=value:key=value ESC \`. Terminals that
 * do not know it drop it silently, so there is no capability handshake:
 * reports go out whenever a terminal is attached.
 *
 * Spec: https://www.superlogical.com/rex/docs/build/program-status
 */

export type ProgramState = "idle" | "working" | "done" | "blocked" | "error";

/** Why a `blocked` report is waiting on the user. */
export type BlockedKind = "permission" | "question" | "auth";

export interface ProgramStatusReport {
  state: ProgramState;
  /** One line for humans; control characters are stripped, URL credentials redacted, and the spec's length cap applied. */
  msg?: string;
  /** 0-100, only meaningful for `working` and `blocked`. */
  progress?: number;
  /** Only meaningful for `blocked`. */
  kind?: BlockedKind;
}

const APP = "bunny";

/** Spec caps; a report over any of them is discarded by the terminal, so trim here instead. */
const MSG_MAX_DECODED_BYTES = 2048;

// Terminals remove `working`/`blocked` records on process exit but keep `done`/`error`.
const ST = "\x1b\\";

// Any scheme, so libsql:// and ftp:// connection strings are covered along with http(s).
const URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const REDACTED = "[redacted]";

/**
 * Strip the credential-bearing parts of every URL in free text: the userinfo
 * and the whole query string, where pre-signed and bearer parameters live.
 * Terminals keep `done`/`error` records after the process exits, so a message
 * that quotes a URL must not quote its token.
 */
export function redactUrls(text: string): string {
  return text.replace(URL_RE, (url) => {
    const host = url.indexOf("//") + 2;
    let end = host;
    while (end < url.length && !"/?#".includes(url.charAt(end))) end++;
    const at = url.lastIndexOf("@", end - 1);
    const authority =
      at >= host ? `${REDACTED}${url.slice(at, end)}` : url.slice(host, end);
    let rest = url.slice(end);
    const query = rest.indexOf("?");
    const hash = rest.indexOf("#");
    if (query !== -1 && (hash === -1 || query < hash)) {
      rest = `${rest.slice(0, query)}?${REDACTED}${hash === -1 ? "" : rest.slice(hash)}`;
    }
    return `${url.slice(0, host)}${authority}${rest}`;
  });
}

function stripControl(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the spec forbids these bytes in decoded text.
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
}

function trimToBytes(text: string, max: number): string {
  let out = text;
  while (Buffer.byteLength(out, "utf8") > max) out = out.slice(0, -1);
  return out;
}

/** The exact bytes for one report, or an empty string when nothing should be sent. */
export function formatProgramStatus(report: ProgramStatusReport): string {
  const pairs = [`state=${report.state}`, `app=${APP}`];
  if (report.kind && report.state === "blocked")
    pairs.push(`kind=${report.kind}`);
  if (
    report.progress !== undefined &&
    Number.isFinite(report.progress) &&
    (report.state === "working" || report.state === "blocked")
  ) {
    const pct = Math.min(100, Math.max(0, Math.round(report.progress)));
    pairs.push(`progress=${pct}`);
  }
  if (report.msg) {
    const text = trimToBytes(
      redactUrls(stripControl(report.msg)),
      MSG_MAX_DECODED_BYTES,
    );
    if (text) pairs.push(`msg=${Buffer.from(text, "utf8").toString("base64")}`);
  }
  return `\x1b]7501;${pairs.join(":")}${ST}`;
}

/** The bytes that remove the CLI's record. */
export function formatProgramStatusClear(): string {
  return `\x1b]7501;state=clear:app=${APP}${ST}`;
}

/**
 * Pick where reports go. The escape must reach the terminal, not a pipe:
 * stderr is preferred so `--output json` on stdout stays clean, and stdout
 * is the fallback when only stderr is redirected. `BUNNYNET_NO_PROGRAM_STATUS`
 * (any value, like `NO_COLOR`) and `TERM=dumb` opt out entirely.
 */
export function programStatusWriter(
  env: Record<string, string | undefined> = process.env,
  stdout: { isTTY?: boolean; write(s: string): unknown } = process.stdout,
  stderr: { isTTY?: boolean; write(s: string): unknown } = process.stderr,
): ((bytes: string) => void) | null {
  if (env.BUNNYNET_NO_PROGRAM_STATUS || env.TERM === "dumb") return null;
  const target = stderr.isTTY ? stderr : stdout.isTTY ? stdout : null;
  return target ? (bytes) => target.write(bytes) : null;
}

/**
 * A reporter bound to one writer. Every report replaces the previous record,
 * so the last non-blocked report is kept and `resume()` restores it after a
 * prompt: `working` -> `blocked` (prompt) -> `working` again.
 */
export function createProgramStatus(write: ((bytes: string) => void) | null) {
  let last: ProgramStatusReport | undefined;

  const send = (report: ProgramStatusReport) => {
    if (report.state !== "blocked") last = report;
    write?.(formatProgramStatus(report));
  };

  return {
    /** Whether reports actually reach a terminal. */
    enabled: write !== null,
    idle: (msg?: string) => send({ state: "idle", msg }),
    working: (msg?: string, progress?: number) =>
      send({ state: "working", msg, progress }),
    done: (msg?: string) => send({ state: "done", msg }),
    error: (msg?: string) => send({ state: "error", msg }),
    blocked: (kind: BlockedKind, msg?: string) =>
      send({ state: "blocked", kind, msg }),
    /** Go back to whatever was reported before a `blocked`; clears the record if nothing was. */
    resume: () => {
      if (last) send(last);
      else write?.(formatProgramStatusClear());
    },
    clear: () => {
      last = undefined;
      write?.(formatProgramStatusClear());
    },
  };
}

export type ProgramStatus = ReturnType<typeof createProgramStatus>;

/** The process-wide reporter. Commands, prompts, and long waits report through this. */
export const programStatus: ProgramStatus = createProgramStatus(
  programStatusWriter(),
);
