import type { components as computeComponents } from "@bunny.net/openapi-client/generated/compute.d.ts";
import type { components as dbComponents } from "@bunny.net/openapi-client/generated/database.d.ts";
import {
  type BunnyProjectConfig,
  CURRENT_VERSION,
  type DatabaseBinding,
  type ScriptBinding,
  type ScriptBindingType,
} from "./schema.ts";

type Database = Pick<dbComponents["schemas"]["Database2"], "id" | "name">;
type EdgeScript = Pick<
  computeComponents["schemas"]["EdgeScriptModel"],
  "Id" | "Name" | "ScriptType"
>;

const SCRIPT_TYPE_NAMES: Record<number, ScriptBindingType> = {
  0: "dns",
  1: "standalone",
  2: "middleware",
};

/** A fresh config with empty resource maps, ready for `bunny project init`. */
export function emptyProjectConfig(name: string): BunnyProjectConfig {
  return {
    version: CURRENT_VERSION,
    name,
    databases: {},
    scripts: {},
  };
}

/** Map a v2 database API response to a config binding entry. */
export function databaseToBinding(db: Database): DatabaseBinding {
  return { id: db.id, name: db.name };
}

/** Map a compute API Edge Script to a config binding entry; throws if the script has no Id. */
export function scriptToBinding(script: EdgeScript): ScriptBinding {
  if (script.Id == null) throw new Error("Edge Script is missing an Id.");
  return {
    id: script.Id,
    name: script.Name ?? undefined,
    type: SCRIPT_TYPE_NAMES[script.ScriptType ?? -1],
  };
}

/** Derive a valid binding name from a resource name (e.g. "My API!" → "my-api"). */
export function suggestBindingName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z]+|[-_]+$/g, "");
  return slug || "resource";
}
