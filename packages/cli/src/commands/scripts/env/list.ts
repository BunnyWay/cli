import { createComputeClient } from "@bunny.net/api";
import type { components } from "@bunny.net/api/generated/compute.d.ts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveManifestId } from "../../../core/manifest.ts";
import { spinner } from "../../../core/ui.ts";
import { SCRIPT_MANIFEST } from "../constants.ts";

type EdgeScriptVariable = components["schemas"]["EdgeScriptVariableModel"];
type EdgeScriptSecret = components["schemas"]["EdgeScriptSecretModel"];

const COMMAND = "list [id]";
const ALIASES = ["ls"] as const;
const DESCRIPTION =
  "List environment variables and secrets for an Edge Script.";

const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";

interface ListArgs {
  [ARG_ID]?: number;
}

/**
 * List all environment variables and secrets for an Edge Script.
 *
 * Fetches both plain variables and encrypted secrets in parallel, then
 * merges them into a single table sorted by name.
 *
 * @example
 * ```bash
 * # List for linked script
 * bunny scripts env list
 *
 * # List by script ID
 * bunny scripts env list 12345
 *
 * # Short alias
 * bunny scripts env ls
 *
 * # JSON output
 * bunny scripts env list --output json
 * ```
 */
export const scriptsEnvListCommand = defineCommand<ListArgs>({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts env list", "List for linked script"],
    ["$0 scripts env list 12345", "List by script ID"],
    ["$0 scripts env list --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs.positional(ARG_ID, {
      type: "number",
      describe: ARG_ID_DESCRIPTION,
    }),

  handler: async ({ [ARG_ID]: rawId, profile, output, verbose, apiKey }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");
    const config = resolveConfig(profile, apiKey);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Fetching environment variables...");
    spin.start();

    const [scriptResult, secretsResult] = await Promise.all([
      client.GET("/compute/script/{id}", {
        params: { path: { id } },
      }),
      client.GET("/compute/script/{id}/secrets", {
        params: { path: { id } },
      }),
    ]);

    spin.stop();

    const variables = scriptResult.data?.EdgeScriptVariables ?? [];
    const secrets = secretsResult.data?.Secrets ?? [];

    const entries = [
      ...variables.map((v: EdgeScriptVariable) => ({
        id: v.Id ?? 0,
        name: v.Name ?? "",
        value: v.DefaultValue ?? "",
        secret: false,
      })),
      ...secrets.map((s: EdgeScriptSecret) => ({
        id: s.Id ?? 0,
        name: s.Name ?? "",
        value: "",
        secret: true,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    if (output === "json") {
      logger.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      logger.info("No environment variables or secrets found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Value", "Secret"],
        entries.map((e) => [
          String(e.id),
          e.name,
          e.value,
          e.secret ? "Yes" : "No",
        ]),
        output,
      ),
    );
  },
});
