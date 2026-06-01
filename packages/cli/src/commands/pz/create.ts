import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import {
  PULL_ZONE_MANIFEST,
  type PullZoneManifest,
} from "./constants.ts";

interface PullZone {
  Id: number;
  Name?: string | null;
}

interface CreateArgs {
  name?: string;
  origin?: string;
}

export const pzCreateCommand = defineCommand<CreateArgs>({
  command: "create <name> <origin>",
  describe: "Create a new pull zone.",
  examples: [
    ["$0 pz create my-zone https://origin.example.com", "Create a pull zone"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", { type: "string", describe: "Pull zone name" })
      .positional("origin", {
        type: "string",
        describe: "Origin URL (https:// is prepended if missing)",
      }),

  handler: async ({ name, origin, profile, output, verbose, apiKey }) => {
    if (!name || !origin) {
      throw new UserError("Name and origin are required.");
    }

    const url = origin.match(/^https?:\/\//) ? origin : `https://${origin}`;

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // Check if zone already exists
    const spin = spinner("Checking for existing zone...");
    spin.start();

    const { data } = await client.GET("/pullzone");
    const zones = (data ?? []) as PullZone[];

    spin.stop();

    const existing = zones.find(
      (z) => z.Name?.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      throw new UserError(`Pull zone "${name}" already exists (ID: ${existing.Id}).`);
    }

    // Create
    const createSpin = spinner("Creating pull zone...");
    createSpin.start();

    await client.POST("/pullzone", {
      body: { Name: name, OriginUrl: url } as any,
    });

    createSpin.stop();

    // Find the new zone to get its ID
    const findSpin = spinner("Fetching new zone...");
    findSpin.start();

    const { data: updated } = await client.GET("/pullzone");
    const newZone = ((updated ?? []) as PullZone[]).find(
      (z) => z.Name?.toLowerCase() === name.toLowerCase(),
    );

    findSpin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ name, origin: url, id: newZone?.Id ?? null }));
      return;
    }

    logger.success(`Pull zone "${name}" created.`);

    // Offer to select it
    if (newZone) {
      const shouldSelect = await confirm(
        `Set "${name}" as the active context?`,
      );
      if (shouldSelect) {
        saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, {
          id: newZone.Id,
          name: newZone.Name ?? undefined,
        });
        logger.success(`Selected ${name}.`);
      }
    }
  },
});
