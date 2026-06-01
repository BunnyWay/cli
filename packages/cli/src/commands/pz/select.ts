import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import {
  PULL_ZONE_MANIFEST,
  type PullZoneManifest,
} from "./constants.ts";
import { resolvePullZoneId } from "./resolve-pullzone.ts";

interface PullZone {
  Id: number;
  Name?: string | null;
}

interface SelectArgs {
  "name-or-id"?: string;
}

export const pzSelectCommand = defineCommand<SelectArgs>({
  command: "select [name-or-id]",
  describe: "Select a pull zone as the active context.",
  examples: [
    ["$0 pz select", "Interactive selection"],
    ["$0 pz select my-zone", "Select by name"],
    ["$0 pz select 12345", "Select by ID"],
  ],

  builder: (yargs) =>
    yargs.positional("name-or-id", {
      type: "string",
      describe: "Pull zone name or ID",
    }),

  handler: async ({ "name-or-id": nameOrId, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    if (nameOrId) {
      const { id, name } = await resolvePullZoneId(client, nameOrId);

      saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, {
        id,
        name,
      });

      if (output === "json") {
        logger.log(JSON.stringify({ id, name }));
        return;
      }

      logger.success(`Selected ${name ?? id}.`);
      return;
    }

    const spin = spinner("Fetching pull zones...");
    spin.start();

    const { data } = await client.GET("/pullzone");

    spin.stop();

    const zones = (data ?? []) as PullZone[];

    if (zones.length === 0) {
      throw new UserError(
        "No pull zones found.",
        'Run "bunny pz create" to create one.',
      );
    }

    const sorted = zones.sort((a, b) =>
      (a.Name ?? "").localeCompare(b.Name ?? ""),
    );

    const { selected } = await prompts({
      type: "select",
      name: "selected",
      message: "Select a pull zone:",
      choices: sorted.map((zone) => ({
        title: zone.Name ?? String(zone.Id),
        value: zone,
      })),
    });

    if (!selected) {
      logger.log("Select cancelled.");
      process.exit(1);
    }

    saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, {
      id: selected.Id,
      name: selected.Name ?? undefined,
    });

    if (output === "json") {
      logger.log(JSON.stringify({ id: selected.Id, name: selected.Name }));
      return;
    }

    logger.success(`Selected ${selected.Name ?? selected.Id}.`);
  },
});
