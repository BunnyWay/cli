import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { VERSION } from "./version.ts";

/** Mirrors the collector's allowlist in BunnyWay/cli-telemetry-edge-script: an event or prop missing there is dropped. */
type PropType = "string" | "number" | "boolean" | readonly string[];

const PROPS = {
  cli_version: "string",
  os: "string",
  arch: "string",
  ci: "boolean",
  command: "string",
  flags: "string",
  result: ["success", "user_error", "api_error", "error"],
  status: "number",
  duration_ms: "number",
  output: "string",
  action: ["create", "update", "delete", "upload", "fetch"],
  size_bytes: "number",
  resumable: "boolean",
  source: "string",
  import_status: ["in_progress", "completed", "failed", "paused"],
  videos: "number",
  failed: "number",
} as const satisfies Record<string, PropType>;

const COMMON_PROPS = ["cli_version", "os", "arch", "ci"] as const;

const EVENTS = {
  command: ["command", "flags", "result", "status", "duration_ms", "output"],
  login: [],
  stream_library: ["action"],
  stream_video: ["action", "size_bytes", "resumable"],
  stream_collection: ["action"],
  stream_import: ["source", "import_status", "videos", "failed"],
} as const satisfies Record<string, readonly (keyof typeof PROPS)[]>;

export type EventName = keyof typeof EVENTS;

type TypeOf<T extends PropType> = T extends readonly string[]
  ? T[number]
  : T extends "string"
    ? string
    : T extends "number"
      ? number
      : boolean;

export type EventProps<E extends EventName> = {
  [K in (typeof EVENTS)[E][number]]?: TypeOf<(typeof PROPS)[K]>;
};

type CommonProps = {
  [K in (typeof COMMON_PROPS)[number]]: TypeOf<(typeof PROPS)[K]>;
};

interface CliEvent {
  event: string;
  id: string;
  anon_id: string;
  time: number;
  props?: Record<string, unknown>;
}

const DEFAULT_URL = "https://cli-telemetry.bunny.net/v1/events";
const SEND_TIMEOUT_MS = 1500;
export const DOCS_URL = "https://docs.bunny.net/cli/telemetry";

interface TelemetryState {
  enabled?: boolean;
  anon_id?: string;
  notified?: boolean;
}

export type TelemetrySource = "env" | "config" | "default";

export interface TelemetryStatus {
  enabled: boolean;
  source: TelemetrySource;
  variable?: string;
}

function statePath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "bunnynet", "telemetry.json");
}

function readState(): TelemetryState {
  try {
    return JSON.parse(readFileSync(statePath(), "utf-8"));
  } catch {
    return {};
  }
}

function writeState(state: TelemetryState): void {
  try {
    mkdirSync(dirname(statePath()), { recursive: true });
    writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
  } catch {}
}

const truthy = (value: string | undefined) =>
  value !== undefined && value !== "" && value !== "0" && value !== "false";

function envOptOut(): string | undefined {
  if (truthy(process.env.BUNNYNET_TELEMETRY_DISABLED))
    return "BUNNYNET_TELEMETRY_DISABLED";
  if (truthy(process.env.DO_NOT_TRACK)) return "DO_NOT_TRACK";
  if (process.env.NODE_ENV === "test") return "NODE_ENV";
  return undefined;
}

export function telemetryStatus(): TelemetryStatus {
  const variable = envOptOut();
  if (variable) return { enabled: false, source: "env", variable };
  const { enabled } = readState();
  if (enabled !== undefined) return { enabled, source: "config" };
  return { enabled: true, source: "default" };
}

export function setTelemetryEnabled(enabled: boolean): void {
  const state = readState();
  // Opting out drops the anonymous ID too, so opting back in starts fresh.
  writeState(
    enabled
      ? { ...state, enabled, notified: true }
      : { enabled, notified: true },
  );
}

const queue: CliEvent[] = [];

function commonProps(): CommonProps {
  return {
    cli_version: VERSION,
    os: process.platform,
    arch: process.arch,
    ci: truthy(process.env.CI),
  };
}

export function track<E extends EventName>(
  event: E,
  props?: EventProps<E>,
): void {
  if (!telemetryStatus().enabled) return;

  queue.push({
    event,
    id: crypto.randomUUID(),
    anon_id: "",
    time: Date.now(),
    props: { ...commonProps(), ...props },
  });
}

export async function flushTelemetry(): Promise<void> {
  if (queue.length === 0) return;
  const events = queue.splice(0);
  if (!telemetryStatus().enabled) return;

  const state = readState();
  if (!state.notified) printNotice();
  const anonId = state.anon_id ?? crypto.randomUUID();
  if (anonId !== state.anon_id || !state.notified) {
    writeState({ ...state, anon_id: anonId, notified: true });

    if (readState().anon_id !== anonId) return;
  }
  for (const e of events) e.anon_id = anonId;

  if (truthy(process.env.BUNNYNET_TELEMETRY_DEBUG)) {
    for (const e of events) console.error(`[telemetry] ${JSON.stringify(e)}`);
    return;
  }

  try {
    await fetch(process.env.BUNNYNET_TELEMETRY_URL || DEFAULT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `bunny-cli/${VERSION}`,
      },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {}
}

function printNotice(): void {
  console.error(
    "\n  The bunny.net CLI collects anonymous usage data to improve the CLI." +
      "\n  Run `bunny telemetry disable` or set BUNNYNET_TELEMETRY_DISABLED=1 to opt out." +
      `\n  Learn more: ${DOCS_URL}\n`,
  );
}

export function invocation(
  argv: Record<string, unknown>,
  aliases: Record<string, string[]> = {},
): {
  command: string;
  flags: string;
} {
  const command = ((argv._ as unknown[]) ?? [])
    .filter((p) => typeof p === "string")
    .join(" ");
  const raw = process.argv.slice(2);
  const end = raw.indexOf("--");
  const names = new Set<string>();
  for (const token of end === -1 ? raw : raw.slice(0, end)) {
    const name = token.match(/^--?([a-zA-Z][\w-]*)/)?.[1];
    if (!name) continue;
    const long =
      Object.keys(aliases).find((key) => aliases[key]?.includes(name)) ?? name;
    // Only keys yargs recognised, so a stray value can never ride along as a flag name.
    if (name in argv) names.add(long);
    else if (name.startsWith("no-") && name.slice(3) in argv)
      names.add(name.slice(3));
  }
  return { command, flags: [...names].sort().join(",") };
}
