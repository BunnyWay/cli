import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMcClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId, resolveContainerId } from "../config.ts";
import { parseDotenv } from "./parse.ts";

const COMMAND = "push [file]";
const DESCRIPTION = "Bulk-set environment variables from a .env file.";

interface PushArgs {
  file?: string;
  id?: string;
  container?: string;
  replace?: boolean;
  "dry-run"?: boolean;
}

export const appsEnvPushCommand = defineCommand<PushArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 apps env push", "Push variables from ./.env, merging with remote"],
    ["$0 apps env push .env.prod", "Push from a specific file"],
    [
      "$0 apps env push .env.prod --replace",
      "Replace the remote env with the file (drops vars not in the file)",
    ],
    ["$0 apps env push --dry-run", "Show what would change without writing"],
  ],

  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "Path to the .env file (defaults to ./.env)",
      })
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.jsonc)",
      })
      .option("container", {
        type: "string",
        describe: "Container name (defaults to primary)",
      })
      .option("replace", {
        type: "boolean",
        describe:
          "Replace all remote variables with the file's contents (default: merge)",
      })
      .option("dry-run", {
        type: "boolean",
        describe: "Show the diff without writing",
      }),

  handler: async ({
    file,
    id: rawId,
    container: containerName,
    replace,
    "dry-run": dryRun,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const filePath = resolve(process.cwd(), file ?? ".env");
    if (!existsSync(filePath)) {
      throw new UserError(`File not found: ${filePath}`);
    }

    const fileVars = parseDotenv(readFileSync(filePath, "utf-8"));
    const fileKeys = Object.keys(fileVars);
    if (fileKeys.length === 0) {
      throw new UserError(`No variables found in ${filePath}.`);
    }

    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const fetchSpin = spinner("Fetching current variables...");
    fetchSpin.start();

    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    fetchSpin.stop();

    if (!app) {
      throw new UserError(`App ${appId} not found.`);
    }

    const containerId = resolveContainerId(app, containerName);
    const container = app.containerTemplates.find((c) => c.id === containerId);
    const existing = container?.environmentVariables ?? [];

    const existingMap: Record<string, string> = {};
    for (const v of existing) existingMap[v.name] = v.value ?? "";

    // Compute the post-push map.
    const next: Record<string, string> = replace
      ? { ...fileVars }
      : { ...existingMap, ...fileVars };

    // Diff for reporting.
    const added: string[] = [];
    const changed: string[] = [];
    const removed: string[] = [];

    for (const key of Object.keys(next)) {
      if (!(key in existingMap)) added.push(key);
      else if (existingMap[key] !== next[key]) changed.push(key);
    }
    if (replace) {
      for (const key of Object.keys(existingMap)) {
        if (!(key in next)) removed.push(key);
      }
    }

    if (added.length + changed.length + removed.length === 0) {
      logger.info("No changes. Remote env matches the file.");
      return;
    }

    if (output !== "json") {
      logger.log(`From ${filePath} → container "${container?.name}":`);
      for (const k of added) logger.success(`  + ${k}`);
      for (const k of changed) logger.info(`  ~ ${k}`);
      for (const k of removed) logger.warn(`  - ${k}`);
    }

    if (dryRun) {
      if (output === "json") {
        logger.log(
          JSON.stringify({ added, changed, removed, dryRun: true }, null, 2),
        );
      } else {
        logger.dim("Dry run. No changes written.");
      }
      return;
    }

    const writeSpin = spinner("Updating variables...");
    writeSpin.start();
    await client.PUT("/apps/{appId}/containers/{containerId}/env", {
      params: { path: { appId, containerId } },
      body: next,
    });
    writeSpin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ added, changed, removed }, null, 2));
      return;
    }

    logger.success(
      `${added.length} added, ${changed.length} updated${replace ? `, ${removed.length} removed` : ""}.`,
    );
  },
});
