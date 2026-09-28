import type { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { UserError } from "@/core/errors.ts";

export type CoreClient = ReturnType<typeof createCoreClient>;
export type StorageZoneModel = components["schemas"]["StorageZoneModel"];
export type StorageZoneSettingsModel =
  components["schemas"]["StorageZoneSettingsModel"];

export type SafeStorageZone = Omit<
  StorageZoneModel,
  "Password" | "ReadOnlyPassword"
>;

// Strip the read-write/read-only passwords so inspect/list/create JSON never
// leaks credentials; use `storage zones credentials` to retrieve those on purpose.
export function toSafeStorageZone(zone: StorageZoneModel): SafeStorageZone {
  const { Password: _p, ReadOnlyPassword: _r, ...safe } = zone;
  return safe;
}

export async function fetchStorageZones(
  client: CoreClient,
): Promise<StorageZoneModel[]> {
  // page=0 (the default) returns every zone as a plain array, no pagination.
  const { data } = await client.GET("/storagezone");
  return (data ?? []).sort((a, b) =>
    (a.Name ?? "").localeCompare(b.Name ?? ""),
  );
}

export async function fetchStorageZone(
  client: CoreClient,
  id: number,
): Promise<StorageZoneModel> {
  const { data } = await client.GET("/storagezone/{id}", {
    params: { path: { id } },
  });
  if (!data) throw new UserError(`Storage zone ${id} not found.`);
  return data;
}

// Resolve a numeric ID directly, or match a name and re-fetch by ID so the
// caller always gets the full record (including the zone password).
export async function resolveStorageZone(
  client: CoreClient,
  nameOrId: string,
): Promise<StorageZoneModel> {
  const ref = nameOrId.trim();
  if (!ref) throw new UserError("A storage zone name or ID is required.");

  if (/^\d+$/.test(ref)) return fetchStorageZone(client, Number(ref));

  const { data } = await client.GET("/storagezone", {
    params: { query: { search: ref } },
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
  return fetchStorageZone(client, match.Id);
}
