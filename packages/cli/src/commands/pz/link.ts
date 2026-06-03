import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
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

interface LinkArgs {
  id?: number;
}

export const pzLinkCommand = defineCommand<LinkArgs>({
  command: "link [id]",
  describe: "Link the current directory to a pull zone.",
  examples: [
    ["$0 pz link", "Interactive selection"],
    ["$0 pz link 12345", "Link by ID"],
  ],

  builder: (yargs) =>
    yargs.positional("id", {
      type: "number",
      describe: "Pull zone ID",
    }),

  handler: async ({ id, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    if (id) {
      saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, { id });

      if (output === "json") {
        logger.log(JSON.stringify({ id }));
        return;
      }

      logger.success(`Linked to pull zone ${id}.`);
      return;
    }

    const spin = spinner("Fetching pull zones...");
    spin.start();

    const { data } = await client.GET("/pullzone");

    spin.stop();

    const zones = (data ?? []) as components["schemas"]["PullZoneModel"][];

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
      message: "Link to a pull zone:",
      choices: sorted.map((zone) => ({
        title: zone.Name ?? String(zone.Id),
        value: zone,
      })),
    });

    if (!selected) {
      logger.log("Link cancelled.");
      process.exit(1);
    }

    saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, {
      id: selected.Id,
    });

    if (output === "json") {
      logger.log(JSON.stringify({ id: selected.Id }));
      return;
    }

    logger.success(`Linked to ${selected.Name ?? selected.Id}.`);
  },
});
