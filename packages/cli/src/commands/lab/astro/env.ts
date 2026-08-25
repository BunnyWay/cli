/**
 * The variables the script reads, and where their values come from.
 *
 * The developer types no password. This command created the zone, so it holds
 * both of them: the read-only one goes to the script, and only a build that
 * writes sessions gets the one that can write.
 *
 * No secret enters the bundle or the config. It is set on the script, and read
 * from the environment at run time.
 */
import type { BuildManifest } from "@bunny.net/config";
import { fetchEnvEntries } from "../../scripts/api.ts";
import type { StorageZoneModel } from "../../storage/api.ts";
import type { ComputeClient } from "./resources.ts";
import { readOnlyPassword, storageHostFor } from "./storage.ts";

export interface ScriptEnv {
  name: string;
  value: string;
  secret?: boolean;
}

/**
 * What this command can set, and what it can only name.
 *
 * `unset` is every variable the manifest asks for that nothing here knows. An
 * API key for cache purging is the usual one: it belongs to the account, not to
 * a zone, so the developer sets it.
 */
export function resolveScriptEnv(
  manifest: BuildManifest,
  zone: StorageZoneModel,
  pullZoneId: number,
): { entries: ScriptEnv[]; unset: string[] } {
  const known: Record<string, ScriptEnv | undefined> = {
    BUNNY_STORAGE_ZONE: { name: "BUNNY_STORAGE_ZONE", value: zone.Name ?? "" },
    BUNNY_STORAGE_HOST: {
      name: "BUNNY_STORAGE_HOST",
      value: storageHostFor(zone.Region),
    },
    BUNNY_STORAGE_KEY: {
      name: "BUNNY_STORAGE_KEY",
      value: readOnlyPassword(zone),
      secret: true,
    },
    BUNNY_PULLZONE_ID: {
      name: "BUNNY_PULLZONE_ID",
      value: String(pullZoneId),
    },
  };
  if (manifest.requires?.storage?.write) {
    known.BUNNY_SESSION_ZONE = {
      name: "BUNNY_SESSION_ZONE",
      value: zone.Name ?? "",
    };
    known.BUNNY_SESSION_KEY = {
      name: "BUNNY_SESSION_KEY",
      value: zone.Password ?? "",
      secret: true,
    };
  }

  const entries: ScriptEnv[] = [];
  const unset: string[] = [];
  for (const want of manifest.requires?.env ?? []) {
    const entry = known[want.name.toUpperCase()];
    if (entry?.value) entries.push(entry);
    else unset.push(want.name);
  }
  return { entries, unset };
}

/**
 * Set the variables, skipping the ones already correct.
 *
 * A secret cannot be read back, so it is written once, when the name is absent.
 * That keeps a rotated password in place, and keeps a deploy from re-writing a
 * secret on every run.
 */
export async function applyScriptEnv(
  client: ComputeClient,
  scriptId: number,
  entries: ScriptEnv[],
): Promise<string[]> {
  const existing = await fetchEnvEntries(client, scriptId);
  const variables = new Map(
    existing
      .filter((e) => !e.secret)
      .map((e) => [e.name.toUpperCase(), e.value]),
  );
  const secrets = new Set(
    existing.filter((e) => e.secret).map((e) => e.name.toUpperCase()),
  );

  const set: string[] = [];
  for (const entry of entries) {
    const name = entry.name.toUpperCase();
    if (entry.secret) {
      if (secrets.has(name)) continue;
      await client.PUT("/compute/script/{id}/secrets", {
        params: { path: { id: scriptId } },
        body: { Name: name, Secret: entry.value },
      });
    } else {
      if (variables.get(name) === entry.value) continue;
      await client.PUT("/compute/script/{id}/variables", {
        params: { path: { id: scriptId } },
        body: { Name: name, DefaultValue: entry.value },
      });
    }
    set.push(name);
  }
  return set;
}
