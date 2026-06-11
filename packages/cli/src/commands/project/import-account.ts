import { createComputeClient, createDbClient } from "@bunny.net/openapi-client";
import {
  type DatabaseBinding,
  databaseToBinding,
  type ResourceKind,
  type ScriptBinding,
  scriptToBinding,
  suggestBindingName,
} from "@bunny.net/project-config";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { spinner } from "../../core/ui.ts";
import { fetchAllDatabases } from "../db/api.ts";
import { fetchScripts } from "../scripts/api.ts";

export interface AccountResource {
  kind: ResourceKind;
  label: string;
  binding: string;
  entry: DatabaseBinding | ScriptBinding;
}

/** Fetch the account's databases and Edge Scripts in parallel as mappable resources. */
export async function fetchAccountResources(opts: {
  profile: string;
  apiKey?: string;
  verbose: boolean;
}): Promise<AccountResource[]> {
  const config = resolveConfig(opts.profile, opts.apiKey, opts.verbose);
  const dbClient = createDbClient(clientOptions(config, opts.verbose));
  const computeClient = createComputeClient(
    clientOptions(config, opts.verbose),
  );

  const spin = spinner("Fetching account resources...");
  spin.start();
  try {
    const [databases, scripts] = await Promise.all([
      fetchAllDatabases(dbClient),
      fetchScripts(computeClient),
    ]);

    return [
      ...databases.map((db): AccountResource => {
        const entry = databaseToBinding(db);
        return {
          kind: "databases",
          label: `database  ${db.name} (${db.id})`,
          binding: suggestBindingName(db.name),
          entry,
        };
      }),
      ...scripts
        .filter((s) => s.Id != null)
        .map((s): AccountResource => {
          const entry = scriptToBinding(s);
          return {
            kind: "scripts",
            label: `script    ${entry.name ?? entry.id} (${entry.id})`,
            binding: suggestBindingName(entry.name ?? String(entry.id)),
            entry,
          };
        }),
    ];
  } finally {
    spin.stop();
  }
}

/** Suffix a binding with -2, -3, ... until it's unique within its resource kind. */
export function uniqueBinding(
  taken: ReadonlySet<string>,
  base: string,
): string {
  let binding = base;
  for (let i = 2; taken.has(binding); i++) binding = `${base}-${i}`;
  return binding;
}
