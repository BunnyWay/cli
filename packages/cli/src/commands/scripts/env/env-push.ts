import type { createComputeClient } from "@bunny.net/openapi-client";
import { fetchEnvEntries } from "@/commands/scripts/api.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, spinner } from "@/core/ui.ts";
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
  secrets?: string[];
  plain?: string[];
  output: OutputFormat;
}

export interface PushResult {
  name: string;
  secret: boolean;
  action: "created" | "updated" | "skipped";
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
  return envPath;
}

function splitList(values?: string[]): Set<string> {
  return new Set(
    (values ?? [])
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
}

/** Which entries to push: everything with --all or no terminal, else a picker. */
async function chooseEntries(
  entries: EnvFileEntry[],
  opts: PushOptions,
): Promise<EnvFileEntry[]> {
  if (opts.all || !isInteractive(opts.output)) return entries;

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
): Promise<Set<string>> {
  const forcedSecret = splitList(opts.secrets);
  const forcedPlain = splitList(opts.plain);
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
  const parsed = parseEnvFile(envPath);
  if (parsed.length === 0) {
    throw new UserError(`No variables found in ${envPath}.`);
  }

  if (isInteractive(opts.output)) {
    logger.info(`Reading ${envPath} (${parsed.length} variables).`);
  }

  const chosen = await chooseEntries(parsed, opts);
  if (chosen.length === 0) return [];

  const secretNames = await chooseSecrets(chosen, opts);

  const spin = spinner("Pushing variables...");
  spin.start();

  const existing = await fetchEnvEntries(client, id);
  const results: PushResult[] = [];

  try {
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
    }
  } finally {
    spin.stop();
  }

  return results;
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
