import { createCoreClient } from "@bunny.net/openapi-client";
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

    // Create
    const createSpin = spinner("Creating pull zone...");
    createSpin.start();

    const { data, error } = await client.POST("/pullzone", {
      body: { Name: name, OriginUrl: url } as any,
    });

    createSpin.stop();

    if (error) {
      throw new UserError(`Failed to create pull zone: ${error}`);
    }

    const created = data as { Id?: number; Name?: string | null } | undefined;
    const createdId = created?.Id;

    if (output === "json") {
      logger.log(JSON.stringify(created, null, 2));
      return;
    }

    logger.success(`Pull zone "${name}" created.`);

    // Offer to select it
    if (createdId) {
      const shouldSelect = await confirm(
        `Set "${name}" as the active context?`,
      );
      if (shouldSelect) {
        saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, {
          id: createdId,
          name: created?.Name ?? undefined,
        });
        logger.success(`Selected ${name}.`);
      }
    }
  },
});
