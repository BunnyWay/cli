import { existsSync } from "node:fs";
import type { createComputeClient } from "@bunny.net/openapi-client";
import { fetchEnvEntries } from "@/commands/scripts/api.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import {
  type EnvFileEntry,
  findEnvFile,
  parseEnvFile,
} from "@/utils/env-file.ts";

type ComputeClient = ReturnType<typeof createComputeClient>;

const SECRET_NAME_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|_KEY|^KEY$)/;

/** Guess whether a variable holds a credential, from its name alone. */
export function looksSecret(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name.toUpperCase());
}

export interface PushOptions {
  file?: string;
  all?: boolean;
  secrets?: string | string[];
  plain?: string | string[];
  output: OutputFormat;
}

export interface PushResult {
  name: string;
  secret: boolean;
  action: "created" | "updated" | "skipped" | "failed";
  reason?: string;
}

function resolveEnvPath(file?: string): string {
  const envPath = file ?? findEnvFile();
  if (!envPath) {
    throw new UserError(
      "No .env file found.",
      "Pass a path explicitly, e.g. `bunny scripts env push .env.production`.",
    );
  }
  if (!existsSync(envPath)) {
    throw new UserError(
      `No such file: ${envPath}.`,
      "Pass the path to an existing .env file, or omit it to use the nearest one.",
    );
  }
  return envPath;
}

function splitList(values?: string | string[]): Set<string> {
  return new Set(
    [values ?? []]
      .flat()
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
}

function requireNamesPresent(
  forced: Set<string>,
  entries: EnvFileEntry[],
  flag: string,
  envPath: string,
): void {
  const present = new Set(entries.map((entry) => entry.key.toUpperCase()));
  const missing = [...forced].filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new UserError(
      `${flag} named ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not in ${envPath}.`,
      `Available: ${entries.map((entry) => entry.key).join(", ")}`,
    );
  }
}

/** Which entries to push: everything with --all, else a picker; no terminal means --all is required. */
async function chooseEntries(
  entries: EnvFileEntry[],
  opts: PushOptions,
  envPath: string,
): Promise<EnvFileEntry[]> {
  if (opts.all) return entries;
  if (!isInteractive(opts.output)) {
    throw new UserError(
      "Nothing chose which variables to push: the picker needs a terminal, and --all was not given.",
      `Run \`bunny scripts env push ${envPath} --all\` to push every variable in the file.`,
    );
  }

  const { picked } = await prompts({
    type: "multiselect",
    name: "picked",
    message: "Variables to push (space to toggle):",
    choices: entries.map((entry) => ({
      title: entry.key,
      value: entry,
      selected: true,
    })),
    hint: "Space to toggle, Enter to confirm",
  });
  return picked ?? [];
}

/** Which of the chosen entries are secrets: --secrets/--plain win, then the name heuristic. */
async function chooseSecrets(
  entries: EnvFileEntry[],
  opts: PushOptions,
  envPath: string,
): Promise<Set<string>> {
  const forcedSecret = splitList(opts.secrets);
  const forcedPlain = splitList(opts.plain);
  requireNamesPresent(forcedSecret, entries, "--secrets", envPath);
  requireNamesPresent(forcedPlain, entries, "--plain", envPath);
  const both = [...forcedSecret].filter((name) => forcedPlain.has(name));
  if (both.length > 0) {
    throw new UserError(
      `${both.join(", ")} ${both.length === 1 ? "is" : "are"} in both --secrets and --plain.`,
      "Name each variable in one of the two.",
    );
  }

  const guess = (key: string) =>
    forcedSecret.has(key.toUpperCase())
      ? true
      : forcedPlain.has(key.toUpperCase())
        ? false
        : looksSecret(key);

  if (opts.all || !isInteractive(opts.output)) {
    return new Set(entries.filter((e) => guess(e.key)).map((e) => e.key));
  }

  const { picked } = await prompts({
    type: "multiselect",
    name: "picked",
    message: "Which are secrets? (stored encrypted, never readable again)",
    choices: entries.map((entry) => ({
      title: entry.key,
      value: entry.key,
      selected: guess(entry.key),
    })),
    hint: "Space to toggle, Enter to confirm",
  });
  return new Set(picked ?? []);
}

/**
 * Push variables from a local `.env` file to an Edge Script.
 *
 * Names already held by the opposite type are skipped rather than failing the
 * whole push, since the API has no way to convert a variable into a secret.
 */
export async function pushEnvFile(
  client: ComputeClient,
  id: number,
  opts: PushOptions,
): Promise<PushResult[]> {
  const envPath = resolveEnvPath(opts.file);
  const { entries, unterminated } = parseEnvFile(envPath);
  if (unterminated.length > 0) {
    throw new UserError(
      `Unclosed quote in ${envPath}: ${unterminated.join(", ")}.`,
      "Close the quote, or the value would be pushed truncated.",
    );
  }
  if (entries.length === 0) {
    throw new UserError(`No variables found in ${envPath}.`);
  }

  if (isInteractive(opts.output)) {
    logger.info(`Reading ${envPath} (${entries.length} variables).`);
  }

  const chosen = await chooseEntries(entries, opts, envPath);
  if (chosen.length === 0) return [];

  const secretNames = await chooseSecrets(chosen, opts, envPath);

  return withSpinner("Pushing variables...", async (spin) => {
    const existing = await fetchEnvEntries(client, id);
    const results: PushResult[] = [];

    for (const entry of chosen) {
      const name = entry.key.toUpperCase();
      const secret = secretNames.has(entry.key);
      const match = existing.find((e) => e.name.toUpperCase() === name);

      if (match && match.secret !== secret) {
        results.push({
          name,
          secret,
          action: "skipped",
          reason: match.secret
            ? "already exists as a secret"
            : "already exists as a variable",
        });
        continue;
      }

      spin.text = `Pushing ${name}...`;
      try {
        if (secret) {
          await client.PUT("/compute/script/{id}/secrets", {
            params: { path: { id } },
            body: { Name: name, Secret: entry.value },
          });
        } else {
          await client.PUT("/compute/script/{id}/variables", {
            params: { path: { id } },
            body: { Name: name, DefaultValue: entry.value },
          });
        }
        results.push({ name, secret, action: match ? "updated" : "created" });
      } catch (err) {
        results.push({
          name,
          secret,
          action: "failed",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  });
}

/** Print the per-variable outcome of a push. */
export function reportPush(results: PushResult[]): void {
  if (results.length === 0) {
    logger.info("Nothing pushed.");
    return;
  }

  for (const result of results) {
    if (result.action === "skipped") {
      logger.warn(`Skipped ${result.name}: ${result.reason}.`);
      continue;
    }
    if (result.action === "failed") {
      logger.error(`Failed ${result.name}: ${result.reason}`);
      continue;
    }
    logger.success(
      `${result.secret ? "Secret" : "Variable"} "${result.name}" ${result.action}.`,
    );
  }

  const skipped = results.filter((r) => r.action === "skipped");
  if (skipped.length > 0) {
    logger.dim(
      `  Remove a conflicting name first: bunny scripts env remove ${skipped[0]?.name}`,
    );
  }
}

// Sets the exit code instead of throwing so the printed report stays the only output.
export function failPushIfIncomplete(results: PushResult[]): void {
  if (results.some((result) => result.action === "failed")) {
    process.exitCode = 1;
  }
}
