import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import type { CoreClient } from "../../context.ts";

export type StorageZoneModel = components["schemas"]["StorageZoneModel"];
export type StorageZoneSettingsModel =
  components["schemas"]["StorageZoneSettingsModel"];

export type SafeStorageZone = Omit<
  StorageZoneModel,
  "Password" | "ReadOnlyPassword"
>;

// Strip the read-write/read-only passwords so inspect/list/create output never
// leaks credentials; use `storage zones credentials` to retrieve those on purpose.
export function toSafeStorageZone(zone: StorageZoneModel): SafeStorageZone {
  const { Password: _p, ReadOnlyPassword: _r, ...safe } = zone;
  return safe;
}

export async function fetchStorageZones(
  client: CoreClient,
  opts: { search?: string; signal?: AbortSignal } = {},
): Promise<StorageZoneModel[]> {
  // page=0 (the default) returns every zone as a plain array, no pagination.
  const { data } = await client.GET("/storagezone", {
    params: opts.search ? { query: { search: opts.search } } : {},
    signal: opts.signal,
  });
  // The endpoint accepts `search` but returns everything anyway, so match here too.
  const term = opts.search?.trim().toLowerCase();
  const zones = term
    ? (data ?? []).filter((zone) =>
        (zone.Name ?? "").toLowerCase().includes(term),
      )
    : (data ?? []);
  return zones.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
}

export async function fetchStorageZone(
  client: CoreClient,
  id: number,
  opts: { signal?: AbortSignal } = {},
): Promise<StorageZoneModel> {
  const { data } = await client.GET("/storagezone/{id}", {
    params: { path: { id } },
    signal: opts.signal,
  });
  if (!data) throw new UserError(`Storage zone ${id} not found.`);
  return data;
}

// Resolve a numeric ID directly, or match a name and re-fetch by ID so the
// caller always gets the full record (including the zone password).
export async function resolveStorageZone(
  client: CoreClient,
  nameOrId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<StorageZoneModel> {
  const ref = nameOrId.trim();
  if (!ref) throw new UserError("A storage zone name or ID is required.");

  if (/^\d+$/.test(ref)) return fetchStorageZone(client, Number(ref), opts);

  const { data } = await client.GET("/storagezone", {
    params: { query: { search: ref } },
    signal: opts.signal,
  });
  const match = (data ?? []).find(
    (zone) => (zone.Name ?? "").toLowerCase() === ref.toLowerCase(),
  );
  if (!match?.Id) {
    throw new UserError(
      `No storage zone found for "${nameOrId}".`,
      'Run "bunny storage zones list" to see your zones.',
    );
  }
  return fetchStorageZone(client, match.Id, opts);
}
