import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { UserError } from "../../../core/errors.ts";
import {
  createHostnamesCommands,
  type ResolvedPullZone,
} from "../../../core/hostnames/index.ts";
import { resolveManifestId } from "../../../core/manifest.ts";
import { fetchScript } from "../api.ts";
import { SCRIPT_MANIFEST } from "../constants.ts";

type EdgeScript = components["schemas"]["EdgeScriptModel"];

/**
 * Resolve which linked pull zone to operate on.
 *
 * Defaults to the script's only linked pull zone. When several exist,
 * requires `--pull-zone` to disambiguate.
 */
function resolvePullZoneId(script: EdgeScript, flag?: number): number {
  const zones = script.LinkedPullZones ?? [];

  if (flag != null) {
    const match = zones.find((z) => z.Id === flag);
    if (!match) {
      throw new UserError(
        `Pull zone ${flag} is not linked to script ${script.Id}.`,
      );
    }
    return flag;
  }

  if (zones.length === 0) {
    throw new UserError(
      `Script ${script.Id} has no linked pull zone.`,
      "Custom hostnames require a linked pull zone.",
    );
  }

  if (zones.length > 1) {
    const list = zones.map((z) => `${z.Id} (${z.PullZoneName})`).join(", ");
    throw new UserError(
      "Script has multiple linked pull zones.",
      `Pass --pull-zone <id> to choose one: ${list}`,
    );
  }

  const id = zones[0]?.Id;
  if (id == null) throw new UserError("Linked pull zone has no ID.");
  return id;
}

/** Resolve a script's pull zone (from manifest/[id]/--id) plus a core client. */
async function resolveScriptPullZone(args: {
  profile: string;
  apiKey?: string;
  verbose: boolean;
  id?: number;
  "pull-zone"?: number;
}): Promise<ResolvedPullZone> {
  const config = resolveConfig(args.profile, args.apiKey, args.verbose);
  const options = clientOptions(config, args.verbose);
  const computeClient = createComputeClient(options);
  const coreClient = createCoreClient(options);

  const scriptId = resolveManifestId(SCRIPT_MANIFEST, args.id, "script");
  const script = await fetchScript(computeClient, scriptId);
  const pullZoneId = resolvePullZoneId(script, args["pull-zone"]);

  return { pullZoneId, coreClient };
}

/** The `domains` namespace + hidden `hostnames` alias, ready to spread into `scripts`. */
export const scriptsHostnamesCommands = createHostnamesCommands({
  commandPath: "scripts domains",
  namespace: "domains",
  describe: "Manage custom domains for an Edge Script.",
  hiddenAliases: ["hostnames"],
  targetPositional: {
    name: "id",
    describe: "Edge Script ID (uses linked script if omitted)",
  },
  target: (yargs) =>
    yargs.option("pull-zone", {
      type: "number",
      describe:
        "Pull zone ID (required if the script has multiple linked zones)",
    }),
  resolve: (args) =>
    resolveScriptPullZone({
      profile: args.profile,
      apiKey: args.apiKey,
      verbose: args.verbose,
      id: args.id as number | undefined,
      "pull-zone": args["pull-zone"] as number | undefined,
    }),
});
