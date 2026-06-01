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
import { resolvePullZoneId } from "./resolve-pullzone.ts";

interface EdgeRule {
  Guid?: string;
  ActionType: number;
  ActionParameter1?: string;
  ActionParameter2?: string;
  Description?: string;
  Enabled: boolean;
  Triggers?: unknown[];
}

interface CloneArgs {
  source?: string;
  target?: string;
}

export const pzCloneCommand = defineCommand<CloneArgs>({
  command: "clone <source> <target>",
  describe: "Clone a pull zone.",
  examples: [
    ["$0 pz clone my-zone my-clone", "Clone by name"],
    ["$0 pz clone 12345 my-clone", "Clone source by ID"],
  ],

  builder: (yargs) =>
    yargs
      .positional("source", { type: "string", describe: "Source pull zone name or ID" })
      .positional("target", { type: "string", describe: "New pull zone name" }),

  handler: async ({ source, target, profile, output, verbose, apiKey }) => {
    if (!source || !target) {
      throw new UserError("Source and target names are required.");
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { id: sourceId } = await resolvePullZoneId(client, source);

    // Fetch full source zone
    const fetchSpin = spinner("Fetching source pull zone...");
    fetchSpin.start();

    const { data } = await client.GET("/pullzone/{id}", {
      params: { path: { id: sourceId } },
    });

    fetchSpin.stop();

    const zone = data as Record<string, unknown> | undefined;
    if (!zone) {
      throw new UserError(`Source pull zone ${sourceId} not found.`);
    }

    // Clone: zero out identity fields, set new name
    const cloneBody = {
      ...zone,
      Id: undefined,
      Name: target,
      EdgeScriptId: undefined,
      MiddlewareScriptId: null,
      Hostnames: [],
      EdgeRules: undefined,
    };

    const createSpin = spinner("Creating clone...");
    createSpin.start();

    const { data: newZoneData, error: createError } = await client.POST("/pullzone", {
      body: cloneBody as any,
    });

    createSpin.stop();

    if (createError) {
      throw new UserError(`Failed to create clone: ${createError}`);
    }

    const newZone = newZoneData as { Id?: number; Name?: string } | undefined;
    const newId = newZone?.Id;
    if (!newId) {
      throw new UserError("Clone created but could not get the new zone ID.");
    }

    // Copy edge rules
    const sourceRules = (zone.EdgeRules ?? []) as EdgeRule[];
    if (sourceRules.length > 0) {
      const ruleSpin = spinner(`Copying ${sourceRules.length} edge rules...`);
      ruleSpin.start();

      for (const rule of sourceRules) {
        const { Guid: _, ...ruleBody } = rule;
        await client.POST("/pullzone/{pullZoneId}/edgerules/addOrUpdate", {
          params: { path: { pullZoneId: newId } },
          body: ruleBody as any,
        });
      }

      ruleSpin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify({ id: newId, name: target, source_id: sourceId }));
      return;
    }

    logger.success(`Cloned "${source}" → "${target}" (ID: ${newId}).`);

    const shouldSelect = await confirm(`Set "${target}" as the active context?`);
    if (shouldSelect) {
      saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, {
        id: newId,
        name: target,
      });
      logger.success(`Selected ${target}.`);
    }
  },
});
