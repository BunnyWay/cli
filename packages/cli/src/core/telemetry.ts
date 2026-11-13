import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CliEvent,
  type CommonProps,
  EVENTS_PATH,
  type EventName,
  type EventProps,
  USER_AGENT_PREFIX,
} from "@bunny.net/cli-telemetry";
import { loadConfigFile } from "@/config/index.ts";
import { VERSION } from "./version.ts";

export type { EventName, EventProps };

/** The credentials a command ran with. */
export interface TelemetryAuth {
  profile: string;
  apiKey?: string;
}

const DEFAULT_URL = `https://cli-telemetry.bunny.net${EVENTS_PATH}`;
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
  // Opting out drops the install ID too, so opting back in starts fresh.
  writeState(
    enabled
      ? { ...state, enabled, notified: true }
      : { enabled, notified: true },
  );
}

const queue: Omit<CliEvent, "anon_id">[] = [];

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
    time: Date.now(),
    props: { ...commonProps(), ...props },
  });
}

/** The API key the command ran with, read at flush time so a login or logout in the same run is reflected. */
function credential(auth?: TelemetryAuth): string | undefined {
  if (!auth) return undefined;
  return (
    auth.apiKey ||
    process.env.BUNNYNET_API_KEY ||
    loadConfigFile()?.profiles[auth.profile]?.api_key ||
    undefined
  );
}

export async function flushTelemetry(auth?: TelemetryAuth): Promise<void> {
  if (queue.length === 0) return;
  const pending = queue.splice(0);
  if (!telemetryStatus().enabled) return;

  const state = readState();
  if (!state.notified) printNotice();
  const anonId = state.anon_id ?? crypto.randomUUID();
  if (anonId !== state.anon_id || !state.notified) {
    writeState({ ...state, anon_id: anonId, notified: true });

    if (readState().anon_id !== anonId) return;
  }
  // The collector parses with the same schema, so anything dropped here would be dropped there.
  const events = pending.flatMap((e) => {
    const parsed = CliEvent.safeParse({ ...e, anon_id: anonId });
    return parsed.success ? [parsed.data] : [];
  });
  if (events.length === 0) return;

  if (truthy(process.env.BUNNYNET_TELEMETRY_DEBUG)) {
    for (const e of events) console.error(`[telemetry] ${JSON.stringify(e)}`);
    return;
  }

  const apiKey = credential(auth);
  try {
    await fetch(process.env.BUNNYNET_TELEMETRY_URL || DEFAULT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `${USER_AGENT_PREFIX}${VERSION}`,
        ...(apiKey && { AccessKey: apiKey }),
      },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {}
}

function printNotice(): void {
  console.error(
    "\n  The bunny.net CLI collects usage data to improve the CLI. When you are authenticated," +
      "\n  it is linked to your bunny.net user and account." +
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
